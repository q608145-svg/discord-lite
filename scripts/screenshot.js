"use strict";

// Снимает скриншот приложения под авторизованным пользователем.
// Использование: node scripts/screenshot.js <base> <cookie> <out.png>

const { execFile } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const base = process.argv[2] || "http://localhost:3141";
const cookieValue = process.argv[3] || "";
const outFile = process.argv[4] || "data/app.png";
const preShotArg = process.argv[5] || "";
// "@путь" — прочитать JS из файла (удобно для длинных скриптов).
const preShotScript = preShotArg.startsWith("@")
  ? fs.readFileSync(preShotArg.slice(1), "utf8")
  : preShotArg;
const chrome =
  process.env.CHROME_PATH ||
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const port = 9222;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "dl-chrome-"));

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

function waitFor(fn, timeout = 15000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const value = await fn();
        if (value) return resolve(value);
      } catch {
        /* ещё не готово */
      }
      if (Date.now() - start > timeout) return reject(new Error("timeout"));
      setTimeout(tick, 250);
    };
    tick();
  });
}

function cdp(ws, id, method, params = {}) {
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

(async () => {
  const child = execFile(chrome, [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    "--window-size=1440,900",
    "about:blank",
  ]);
  void child;

  const version = await waitFor(() => httpJson(`http://127.0.0.1:${port}/json/version`));
  const targets = await waitFor(async () => {
    const list = await httpJson(`http://127.0.0.1:${port}/json/list`);
    return list.find((t) => t.type === "page");
  });

  const ws = new WebSocket(targets.webSocketDebuggerUrl);
  await new Promise((resolve) => ws.addEventListener("open", resolve));

  let id = 1;
  await cdp(ws, id++, "Page.enable");
  await cdp(ws, id++, "Network.enable");

  const url = new URL(base);
  if (cookieValue) {
    await cdp(ws, id++, "Network.setCookie", {
      name: "dl_session",
      value: cookieValue,
      domain: url.hostname,
      path: "/",
      httpOnly: true,
    });
  }

  await cdp(ws, id++, "Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await cdp(ws, id++, "Page.navigate", { url: base });

  await new Promise((r) => setTimeout(r, 3500));

  if (preShotScript) {
    await cdp(ws, id++, "Runtime.evaluate", {
      expression: preShotScript,
      awaitPromise: true,
      returnByValue: true,
    });
    await new Promise((r) => setTimeout(r, 800));
  }
  const shot = await cdp(ws, id++, "Page.captureScreenshot", { format: "png" });
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, Buffer.from(shot.data, "base64"));
  console.log("screenshot:", outFile);

  ws.close();
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
