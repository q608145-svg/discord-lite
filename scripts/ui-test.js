"use strict";

// UI-тест: создание сервера и канала через модальные окна (без window.prompt).
// Запуск: node scripts/ui-test.js [http://localhost:3000]

const { execFile } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const base = (process.argv[2] || "http://localhost:3000").replace(/\/$/, "");
const chrome =
  process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const port = 9666;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "dl-ui-"));

let failed = 0;
const pageErrors = [];

function check(name, ok, extra = "") {
  if (ok) console.log("  ✓", name);
  else {
    failed++;
    console.log("  ✗", name, extra);
  }
}

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
      setTimeout(tick, 200);
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
  if (res.exceptionDetails) {
    throw new Error(
      res.exceptionDetails.exception?.description ||
        res.exceptionDetails.text ||
        "ошибка выполнения"
    );
  }
  return res.result && res.result.value;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  console.log("UI-тест:", base);

  // 1) Свежий аккаунт
  const suffix = Math.random().toString(36).slice(2, 7);
  const reg = await fetch(base + "/api/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      username: "ui_" + suffix,
      displayName: "UI Тест",
      password: "password123",
    }),
  });
  if (reg.status !== 201) throw new Error("register: " + (await reg.text()));
  const cookie = (reg.headers.getSetCookie() || [])[0].split(";")[0];

  // 2) Браузер
  execFile(chrome, [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
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
  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data);
    if (msg.method === "Runtime.exceptionThrown") {
      const text =
        msg.params.exceptionDetails.exception?.description ||
        msg.params.exceptionDetails.text ||
        "exception";
      pageErrors.push(text);
    }
  });

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
  await waitFor(() => evaluate(ws, `!!document.querySelector(".guild-btn.add")`), 25000);

  // 3) Запрещаем нативные диалоги: если код всё ещё их вызывает — увидим исключение.
  await evaluate(
    ws,
    `(() => {
      const boom = () => { throw new Error("native dialog used"); };
      window.prompt = boom;
      window.confirm = boom;
      window.alert = boom;
      return true;
    })()`
  );

  // 4) Создание сервера
  await evaluate(ws, `document.querySelector(".guild-btn.add").click(); true`);
  await waitFor(() => evaluate(ws, `!!document.querySelector('.dl-overlay')`));
  const dialogTitle = await evaluate(ws, `document.querySelector(".dl-dialog__title").textContent`);
  check("Открылось окно создания сервера", dialogTitle === "Создать сервер", dialogTitle);

  await evaluate(
    ws,
    `(() => {
      const input = document.querySelector(".dl-input");
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      setter.call(input, "Мой сервер");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    })()`
  );
  check(
    "Кнопка создания активна после ввода",
    await evaluate(ws, `!document.querySelector('.dl-dialog button[type="submit"]').disabled`)
  );

  await evaluate(ws, `document.querySelector('.dl-dialog button[type="submit"]').click(); true`);
  await waitFor(
    () => evaluate(ws, `[...document.querySelectorAll(".guild-btn")].some(b => b.textContent.includes("М"))`),
    15000
  );
  check("Сервер создан и появился в рейле", true);
  check("Окно закрылось после создания", await evaluate(ws, `!document.querySelector('.dl-overlay')`));

  // 5) Создание текстового канала
  const channelsBefore = await evaluate(ws, `document.querySelectorAll(".channel-item").length`);
  await evaluate(
    ws,
    `[...document.querySelectorAll(".channel-section button")][0].click(); true`
  );
  await waitFor(() =>
    evaluate(ws, `document.querySelector(".dl-dialog__title")?.textContent === "Создать текстовый канал"`)
  );
  check("Открылось окно создания канала", true);

  await evaluate(
    ws,
    `(() => {
      const input = document.querySelector(".dl-input");
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      setter.call(input, "тест-канал");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    })()`
  );
  await evaluate(ws, `document.querySelector('.dl-dialog button[type="submit"]').click(); true`);
  await waitFor(
    () => evaluate(ws, `[...document.querySelectorAll(".channel-item")].some(b => b.textContent.includes("тест-канал"))`),
    15000
  );
  const channelsAfter = await evaluate(ws, `document.querySelectorAll(".channel-item").length`);
  check("Канал создан", channelsAfter === channelsBefore + 1, `${channelsBefore} → ${channelsAfter}`);

  // 6) Escape закрывает окно
  await evaluate(ws, `document.querySelector(".guild-btn.add").click(); true`);
  await waitFor(() => evaluate(ws, `!!document.querySelector('.dl-overlay')`));
  await cdp(ws, "Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Escape",
    code: "Escape",
    windowsVirtualKeyCode: 27,
  });
  await sleep(300);
  check("Escape закрывает окно", await evaluate(ws, `!document.querySelector('.dl-overlay')`));

  // 7) Подтверждение выхода
  await evaluate(ws, `document.querySelector('.user-panel .icon-btn.danger').click(); true`);
  await waitFor(() =>
    evaluate(ws, `document.querySelector(".dl-dialog__title")?.textContent === "Выйти из аккаунта?"`)
  );
  check("Окно подтверждения выхода открывается", true);
  await evaluate(ws, `[...document.querySelectorAll(".dl-dialog button")].find(b => b.textContent === "Отмена").click(); true`);
  await sleep(300);
  check("Отмена закрывает подтверждение", await evaluate(ws, `!document.querySelector('.dl-overlay')`));

  // 8) Нативные диалоги не вызывались
  check("window.prompt/confirm не использовались", pageErrors.length === 0, pageErrors.join(" | "));

  // Скриншот окна создания сервера
  await evaluate(ws, `document.querySelector(".guild-btn.add").click(); true`);
  await waitFor(() => evaluate(ws, `!!document.querySelector('.dl-overlay')`));
  await sleep(300);
  const shot = await cdp(ws, "Page.captureScreenshot", { format: "png" });
  fs.mkdirSync("data", { recursive: true });
  fs.writeFileSync("data/dialog.png", Buffer.from(shot.data, "base64"));
  console.log("  скриншот: data/dialog.png");

  ws.close();
  console.log(failed ? `\nПровалено: ${failed}` : "\nМодальные окна работают, нативных диалогов нет.");
  process.exit(failed ? 1 : 0);
})().catch((err) => {
  console.error("Ошибка теста:", err.message);
  process.exit(1);
});
