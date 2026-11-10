"use strict";

// Главный процесс Electron-клиента discord-lite.
//
// Приложение — тонкий клиент: оно открывает веб-интерфейс с вашего сервера
// (VPS, домашний ПК или LiveKit Cloud + хостинг). Адрес сервера спрашивается
// при первом запуске и хранится в userData/config.json.

const {
  app,
  BrowserWindow,
  Menu,
  dialog,
  ipcMain,
  net,
  session,
  shell,
} = require("electron");
const path = require("node:path");
const fs = require("node:fs");

const {
  DEFAULT_SERVER,
  normalizeServerUrl,
  readConfig,
  writeConfig,
} = require("./config");

const APP_ID = "com.discordlite.desktop";
const TITLEBAR_HEIGHT = 40;
const ICON = path.join(__dirname, "..", "build", "icon.ico");
const IS_WINDOWS = process.platform === "win32";

let mainWindow = null;
let setupWindow = null;
let config = { serverUrl: "", bounds: null };
let quitting = false;

// Один экземпляр приложения.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (setupWindow) {
      setupWindow.show();
      setupWindow.focus();
      return;
    }
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

function userDataDir() {
  return app.getPath("userData");
}

function loadConfig() {
  config = readConfig(userDataDir());
  const fromEnv = normalizeServerUrl(process.env.DISCORD_LITE_URL || "");
  if (fromEnv) config.serverUrl = fromEnv;
  return config;
}

function saveConfig(next) {
  config = { ...config, ...next };
  writeConfig(userDataDir(), config);
}

/** Разрешения, нужные для звонков и уведомлений. */
function setupPermissions() {
  const allowed = new Set([
    "media",
    "audioCapture",
    "videoCapture",
    "display-capture",
    "notifications",
    "clipboard-read",
    "clipboard-sanitized-write",
  ]);

  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(allowed.has(permission));
  });

  session.defaultSession.setPermissionCheckHandler((_wc, permission) =>
    allowed.has(permission)
  );

  // Демонстрация экрана: Electron требует явно выбрать источник.
  session.defaultSession.setDisplayMediaRequestHandler(
    async (request, callback) => {
      try {
        const { desktopCapturer } = require("electron");
        const sources = await desktopCapturer.getSources({
          types: ["screen", "window"],
          thumbnailSize: { width: 0, height: 0 },
        });
        if (!sources.length) return callback({});
        const primary = sources.find((s) => s.name.toLowerCase().includes("экран")) || sources[0];
        callback({
          video: primary,
          audio: request.audioRequested && IS_WINDOWS ? "loopback" : undefined,
        });
      } catch {
        callback({});
      }
    }
  );
}

function setupDownloadHandling(win) {
  win.webContents.session.on("will-download", (_event, item) => {
    // Файлы из чата просто скачиваются в «Загрузки» с диалогом сохранения.
    item.setSaveDialogOptions({ title: "Сохранить файл" });
  });
}

/** Небольшая прослойка, которая делает окно похожим на Discord. */
function injectDesktopChrome(win) {
  const css = `
    html.dl-desktop body { padding-top: ${TITLEBAR_HEIGHT}px !important; overflow: hidden; }
    html.dl-desktop .app { height: calc(100vh - ${TITLEBAR_HEIGHT}px) !important; }
    html.dl-desktop #dl-titlebar {
      position: fixed; top: 0; left: 0; right: 0; height: ${TITLEBAR_HEIGHT}px;
      z-index: 2147483000; display: flex; align-items: center; gap: 10px;
      padding: 0 148px 0 16px; background: #1e1f22;
      border-bottom: 1px solid rgba(0, 0, 0, 0.45);
      -webkit-app-region: drag; user-select: none;
      font: 600 12px/1 "Segoe UI", system-ui, sans-serif; color: #949ba4;
    }
    html.dl-desktop #dl-titlebar .dl-dot {
      width: 10px; height: 10px; border-radius: 50%; background: #5865f2;
      box-shadow: 0 0 0 3px rgba(88, 101, 242, 0.18);
    }
    html.dl-desktop #dl-titlebar .dl-title { color: #dbdee1; letter-spacing: 0.01em; }
    html.dl-desktop #dl-titlebar .dl-host { opacity: 0.75; margin-left: auto; }
    html.dl-desktop #dl-titlebar .dl-host:empty { display: none; }
    html.dl-desktop #dl-titlebar #dl-settings {
      -webkit-app-region: no-drag; margin-left: 12px; flex: 0 0 auto;
      background: #2b2d31; color: #dbdee1; border: none; border-radius: 6px;
      padding: 4px 8px; font-size: 12px; cursor: pointer;
    }
    html.dl-desktop #dl-titlebar #dl-settings:hover { background: #3a3c41; }
  `;

  win.webContents.on("did-finish-load", () => {
    win.webContents
      .insertCSS(css)
      .then(() => {
        const host = (() => {
          try {
            return new URL(config.serverUrl).host;
          } catch {
            return "";
          }
        })();
        const script = `(() => {
          document.documentElement.classList.add("dl-desktop");
          if (document.getElementById("dl-titlebar")) return;
          const bar = document.createElement("div");
          bar.id = "dl-titlebar";
          bar.innerHTML = '<span class="dl-dot"></span><span class="dl-title">discord-lite</span><span class="dl-host">${host}</span><button id="dl-settings" title="Сменить сервер">⚙ Сервер</button>';
          bar.querySelector("#dl-settings").addEventListener("click", () => {
            if (window.desktop) window.desktop.openSetup();
          });
          document.body.appendChild(bar);
        })();`;
        win.webContents.executeJavaScript(script, true).catch(() => undefined);
      })
      .catch(() => undefined);
  });
}

function createMainWindow() {
  const bounds = config.bounds || {};
  const win = new BrowserWindow({
    width: bounds.width || 1280,
    height: bounds.height || 820,
    x: bounds.x,
    y: bounds.y,
    minWidth: 960,
    minHeight: 600,
    show: false,
    backgroundColor: "#1e1f22",
    icon: ICON,
    title: "discord-lite",
    autoHideMenuBar: true,
    titleBarStyle: IS_WINDOWS ? "hidden" : "default",
    titleBarOverlay: IS_WINDOWS
      ? { color: "#1e1f22", symbolColor: "#dbdee1", height: TITLEBAR_HEIGHT }
      : undefined,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: true,
      backgroundThrottling: false,
    },
  });

  mainWindow = win;

  win.once("ready-to-show", () => {
    win.show();
    if (config.bounds && config.bounds.maximized) win.maximize();
  });

  win.on("close", () => {
    if (!win.isDestroyed()) {
      const b = win.getNormalBounds ? win.getNormalBounds() : win.getBounds();
      saveConfig({ bounds: { ...b, maximized: win.isMaximized() } });
    }
  });

  win.on("closed", () => {
    mainWindow = null;
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url).catch(() => undefined);
    return { action: "deny" };
  });

  win.webContents.on("will-navigate", (event, url) => {
    const target = normalizeServerUrl(url);
    const current = normalizeServerUrl(config.serverUrl);
    if (target && current && target !== current) {
      event.preventDefault();
      shell.openExternal(url).catch(() => undefined);
    }
  });

  win.webContents.on("render-process-gone", async (_e, details) => {
    if (quitting) return;
    const { response } = await dialog.showMessageBox(win, {
      type: "error",
      title: "discord-lite",
      message: "Окно приложения перезагружается",
      detail: `Причина: ${details.reason}`,
      buttons: ["Перезагрузить", "Закрыть"],
      defaultId: 0,
    });
    if (response === 0) win.reload();
    else win.close();
  });

  win.webContents.on("did-fail-load", async (_e, code, description, url, isMainFrame) => {
    if (!isMainFrame || quitting) return;
    if (url.startsWith("devtools://") || url === "about:blank") return;
    const { response } = await dialog.showMessageBox(win, {
      type: "warning",
      title: "Сервер недоступен",
      message: `Не удалось открыть ${config.serverUrl}`,
      detail: `${description} (${code}). Проверьте, что сервер запущен и доступен по этому адресу.`,
      buttons: ["Повторить", "Сменить сервер", "Выход"],
      defaultId: 0,
      cancelId: 2,
    });
    if (response === 0) win.loadURL(config.serverUrl);
    else if (response === 1) openSetupWindow();
    else app.quit();
  });

  setupDownloadHandling(win);
  injectDesktopChrome(win);

  win.loadURL(config.serverUrl);
  return win;
}

function createSetupWindow() {
  if (setupWindow) {
    setupWindow.show();
    setupWindow.focus();
    return setupWindow;
  }

  const win = new BrowserWindow({
    width: 520,
    height: 560,
    resizable: false,
    minimizable: false,
    maximizable: false,
    show: false,
    backgroundColor: "#1e1f22",
    icon: ICON,
    title: "discord-lite — подключение",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  setupWindow = win;
  win.once("ready-to-show", () => win.show());
  win.on("closed", () => {
    setupWindow = null;
  });

  win.loadFile(path.join(__dirname, "setup.html"));
  return win;
}

function openSetupWindow() {
  if (mainWindow) mainWindow.hide();
  createSetupWindow();
}

function finishSetup(serverUrl) {
  if (!serverUrl) return;
  saveConfig({ serverUrl });
  if (setupWindow) {
    setupWindow.close();
    setupWindow = null;
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.loadURL(serverUrl);
    mainWindow.show();
    return;
  }
  createMainWindow();
}

function buildMenu() {
  const template = [
    {
      label: "Сервер",
      submenu: [
        {
          label: "Сменить сервер…",
          click: () => openSetupWindow(),
        },
        {
          label: "Открыть в браузере",
          click: () => {
            if (config.serverUrl) shell.openExternal(config.serverUrl);
          },
        },
        { type: "separator" },
        { role: "quit", label: "Выход" },
      ],
    },
    {
      label: "Вид",
      submenu: [
        {
          label: "Обновить",
          accelerator: "CmdOrCtrl+R",
          click: () => mainWindow && mainWindow.reload(),
        },
        {
          label: "Принудительно обновить",
          accelerator: "CmdOrCtrl+Shift+R",
          click: () => mainWindow && mainWindow.webContents.reloadIgnoringCache(),
        },
        { type: "separator" },
        { role: "resetZoom", label: "Обычный масштаб" },
        { role: "zoomIn", label: "Увеличить" },
        { role: "zoomOut", label: "Уменьшить" },
        { type: "separator" },
        { role: "togglefullscreen", label: "Полный экран" },
        {
          label: "Инструменты разработчика",
          accelerator: "CmdOrCtrl+Shift+I",
          click: () => {
            if (mainWindow) mainWindow.webContents.toggleDevTools();
          },
        },
      ],
    },
    {
      label: "Справка",
      submenu: [
        {
          label: "О приложении",
          click: async () => {
            await dialog.showMessageBox({
              type: "info",
              title: "О приложении",
              message: "discord-lite",
              detail:
                `Версия: ${app.getVersion()}\n` +
                `Electron: ${process.versions.electron}\n` +
                `Chromium: ${process.versions.chrome}\n` +
                `Сервер: ${config.serverUrl || "не выбран"}\n\n` +
                "Свой чат и голосовые комнаты на LiveKit.",
              buttons: ["Ок"],
            });
          },
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------------------------------------------------------------- IPC

ipcMain.handle("app:info", () => ({
  version: app.getVersion(),
  platform: process.platform,
  serverUrl: config.serverUrl,
}));

ipcMain.handle("server:check", async (_event, rawUrl) => {
  const url = normalizeServerUrl(rawUrl);
  if (!url) return { ok: false, error: "Некорректный адрес" };
  try {
    const response = await net.fetch(`${url}/api/health`, {
      method: "GET",
      cache: "no-store",
    });
    if (!response.ok) {
      return { ok: false, error: `Сервер ответил ${response.status}` };
    }
    const data = await response.json().catch(() => ({}));
    return { ok: true, url, livekit: Boolean(data.livekit) };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Сервер не отвечает",
    };
  }
});

ipcMain.handle("server:save", (_event, rawUrl) => {
  const url = normalizeServerUrl(rawUrl);
  if (!url) return { ok: false, error: "Некорректный адрес" };
  finishSetup(url);
  return { ok: true, url };
});

ipcMain.handle("setup:open", () => {
  openSetupWindow();
  return { ok: true };
});

ipcMain.handle("setup:close", () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    setupWindow && setupWindow.close();
    mainWindow.show();
    return { ok: true };
  }
  app.quit();
  return { ok: true };
});

// ---------------------------------------------------------------- lifecycle

app.setAppUserModelId(APP_ID);

app.whenReady().then(async () => {
  loadConfig();
  setupPermissions();
  buildMenu();

  if (config.serverUrl) {
    createMainWindow();
  } else {
    createSetupWindow();
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      if (config.serverUrl) createMainWindow();
      else createSetupWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  quitting = true;
});

// Вспомогательное: локальный файл лога рядом с приложением (для диагностики).
process.on("uncaughtException", (err) => {
  try {
    const logDir = path.join(app.getPath("userData"), "logs");
    fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(
      path.join(logDir, "main.log"),
      `[${new Date().toISOString()}] ${err && err.stack ? err.stack : err}\n`
    );
  } catch {
    /* ignore */
  }
  dialog.showErrorBox("discord-lite", String(err && err.message ? err.message : err));
});
