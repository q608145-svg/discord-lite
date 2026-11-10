"use strict";

// Сквозная проверка голоса в реальном браузере (headless Chrome + фейковый микрофон).
// Запуск: node scripts/voice-e2e.js [http://localhost:3000] [data/voice.png]

const { execFile } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const base = (process.argv[2] || "http://localhost:3000").replace(/\/$/, "");
const outFile = process.argv[3] || "data/voice.png";
const chrome =
  process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const port = 9333;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "dl-voice-"));

function httpJson(url) {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        let body = "";
        res.on("data", (d) => (body += d));
        res.on("end", () => {
          try {
            resolve(JSON.parse(body));
          } catch (err) {
            reject(err);
          }
        });
      })
      .on("error", reject);
  });
}

function waitFor(fn, timeout = 20000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const value = await fn();
        if (value) return resolve(value);
      } catch {
        /* not ready */
      }
      if (Date.now() - start > timeout) return reject(new Error("timeout"));
      setTimeout(tick, 250);
    };
    tick();
  });
}

let msgId = 1;
function cdp(ws, method, params = {}) {
  const id = msgId++;
  return new Promise((resolve, reject) => {
    const onMessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id !== id) return;
      ws.removeEventListener("message", onMessage);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
    };
    ws.addEventListener("message", onMessage);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(ws, expression) {
  const res = await cdp(ws, "Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  return res.result && res.result.value;
}

async function api(pathname, { method = "GET", body, cookie } = {}) {
  const res = await fetch(base + "/api" + pathname, {
    method,
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, text, headers: res.headers };
}

(async () => {
  // 1) Тестовый пользователь с сервером и голосовым каналом
  const suffix = Math.random().toString(36).slice(2, 7);
  const reg = await api("/auth/register", {
    method: "POST",
    body: { username: "voice_" + suffix, displayName: "Голос", password: "password123" },
  });
  if (reg.status !== 201) throw new Error("register: " + reg.text);
  const cookie = (reg.headers.getSetCookie() || [])[0].split(";")[0];

  await api("/guilds", {
    method: "POST",
    body: { name: "Голосовой тест" },
    cookie,
  });
  const guilds = JSON.parse((await api("/guilds", { cookie })).text);
  const guild = guilds.guilds[0];
  const voice = guild.channels.find((c) => c.type === "voice");

  // 2) Браузер с фейковым микрофоном
  execFile(chrome, [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    "--autoplay-policy=no-user-gesture-required",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    "--window-size=1440,900",
    "about:blank",
  ]);

  await waitFor(() => httpJson(`http://127.0.0.1:${port}/json/version`));
  const target = await waitFor(async () => {
    const list = await httpJson(`http://127.0.0.1:${port}/json/list`);
    return list.find((t) => t.type === "page");
  });

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r));

  await cdp(ws, "Page.enable");
  await cdp(ws, "Runtime.enable");
  await cdp(ws, "Network.enable");
  await cdp(ws, "Network.setCookie", {
    name: "dl_session",
    value: cookie.slice("dl_session=".length),
    domain: new URL(base).hostname,
    path: "/",
    httpOnly: true,
  });
  await cdp(ws, "Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });

  await cdp(ws, "Page.navigate", { url: base });

  // 3) Ждём загрузку списка каналов и жмём голосовой канал
  await waitFor(
    () => evaluate(ws, `document.body.innerText.includes("Голосовой тест")`),
    25000
  );

  const clicked = await evaluate(
    ws,
    `(() => {
      const btn = [...document.querySelectorAll("button.channel-item")]
        .find((b) => b.textContent.includes(${JSON.stringify(voice.name)}));
      if (!btn) return false;
      btn.click();
      return true;
    })()`
  );
  if (!clicked) throw new Error("не нашёл кнопку голосового канала");

  // 4) Ждём подключение к LiveKit
  await new Promise((r) => setTimeout(r, 9000));

  const state = await evaluate(
    ws,
    `(() => {
      const tiles = document.querySelectorAll(".voice-tile").length;
      const text = document.body.innerText;
      return {
        tiles,
        error: /could not establish|Failed to fetch|Ошибка/i.test(text)
          ? text.split("\\n").filter((l) => /could not establish|Failed to fetch|Ошибка/i.test(l)).join(" | ")
          : "",
        status: (document.querySelector(".chat-header .sub") || {}).textContent || "",
      };
    })()`
  );

  console.log("Участников в комнате:", state.tiles);
  console.log("Статус:", state.status);
  console.log("Ошибки:", state.error || "нет");

  const shot = await cdp(ws, "Page.captureScreenshot", { format: "png" });
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, Buffer.from(shot.data, "base64"));
  console.log("Скриншот:", outFile);

  const ok = state.tiles >= 1 && !state.error;
  console.log(ok ? "\nГолос подключился." : "\nГолос НЕ подключился.");
  ws.close();
  process.exit(ok ? 0 : 1);
})().catch((err) => {
  console.error("Ошибка проверки:", err.message);
  process.exit(1);
});
