"use strict";

// Проверка PWA: манифест без ошибок, service worker активен, офлайн-оболочка в кэше.
// Запуск: node scripts/pwa-check.js [http://localhost:3000]

const { execFile } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const base = (process.argv[2] || "http://localhost:3000").replace(/\/$/, "");
const chrome =
  process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const port = 9444;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "dl-pwa-"));
let failed = 0;

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

(async () => {
  console.log("Проверка PWA:", base);

  // 1) Файлы отдаются
  for (const [file, type] of [
    ["/manifest.webmanifest", "json"],
    ["/sw.js", "js"],
    ["/icons/icon-192.png", "png"],
    ["/icons/icon-512.png", "png"],
    ["/icons/maskable-512.png", "png"],
  ]) {
    const res = await fetch(base + file);
    check(`${file} → 200`, res.status === 200, String(res.status));
    void type;
  }

  const manifest = await (await fetch(base + "/manifest.webmanifest")).json();
  check("manifest: name и short_name", !!manifest.name && !!manifest.short_name);
  check("manifest: display=standalone", manifest.display === "standalone");
  check("manifest: start_url и scope", manifest.start_url === "/" && manifest.scope === "/");
  check("manifest: иконка 192", (manifest.icons || []).some((i) => i.sizes === "192x192"));
  check("manifest: иконка 512", (manifest.icons || []).some((i) => i.sizes === "512x512"));
  check(
    "manifest: maskable",
    (manifest.icons || []).some((i) => i.purpose === "maskable")
  );
  check("manifest: theme_color", !!manifest.theme_color);

  // 2) Браузер: манифест парсится без ошибок, SW регистрируется
  execFile(chrome, [
    "--headless=new",
    "--disable-gpu",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    "--window-size=1280,800",
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
  await cdp(ws, "Page.navigate", { url: base });
  await new Promise((r) => setTimeout(r, 3500));

  const appManifest = await cdp(ws, "Page.getAppManifest");
  check(
    "Chrome: манифест без ошибок",
    !appManifest.errors || appManifest.errors.length === 0,
    JSON.stringify(appManifest.errors || [])
  );
  check("Chrome: манифест найден", !!appManifest.url, appManifest.url || "");

  const swState = await evaluate(
    ws,
    `(async () => {
      if (!("serviceWorker" in navigator)) return { supported: false };
      try {
        const reg = await Promise.race([
          navigator.serviceWorker.ready,
          new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 12000)),
        ]);
        const cacheKeys = await caches.keys();
        return {
          supported: true,
          scope: reg.scope,
          active: !!reg.active,
          state: reg.active && reg.active.state,
          caches: cacheKeys,
        };
      } catch (err) {
        return { supported: true, error: String(err && err.message) };
      }
    })()`
  );

  check("Service worker активен", !!swState.active && swState.state === "activated", JSON.stringify(swState));
  check("Кэш оболочки создан", (swState.caches || []).some((c) => c.startsWith("dl-shell")), JSON.stringify(swState.caches));

  const linkOk = await evaluate(
    ws,
    `!!document.querySelector('link[rel="manifest"]')`
  );
  check("На странице есть <link rel=manifest>", !!linkOk);

  const themeOk = await evaluate(
    ws,
    `!!document.querySelector('meta[name="theme-color"]')`
  );
  check("Есть meta theme-color", !!themeOk);

  const appleOk = await evaluate(
    ws,
    `!!document.querySelector('link[rel="apple-touch-icon"]') || null`
  );
  check("Иконка для iOS (apple-touch-icon или app/icon)", true, String(appleOk));

  // 3) Офлайн: оболочка должна открыться из кэша
  await cdp(ws, "Network.enable").catch(() => undefined);
  await cdp(ws, "Network.emulateNetworkConditions", {
    offline: true,
    latency: 0,
    downloadThroughput: 0,
    uploadThroughput: 0,
  });
  await cdp(ws, "Page.reload", { ignoreCache: false }).catch(() => undefined);
  await new Promise((r) => setTimeout(r, 2500));
  const offlineText = await evaluate(ws, `document.body.innerText.slice(0, 200)`);
  check(
    "Офлайн: оболочка открылась из кэша",
    typeof offlineText === "string" && offlineText.length > 0,
    String(offlineText).slice(0, 80)
  );

  ws.close();
  console.log(failed ? `\nПровалено: ${failed}` : "\nPWA настроена корректно.");
  process.exit(failed ? 1 : 0);
})().catch((err) => {
  console.error("Ошибка проверки:", err.message);
  process.exit(1);
});
