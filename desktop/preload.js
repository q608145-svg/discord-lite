"use strict";

// Мост между окном и главным процессом. Node в окне отключён,
// наружу отдаём только безопасный минимум.

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktop", {
  isDesktop: true,
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
  getInfo: () => ipcRenderer.invoke("app:info"),
  checkServer: (url) => ipcRenderer.invoke("server:check", url),
  saveServer: (url) => ipcRenderer.invoke("server:save", url),
  closeSetup: () => ipcRenderer.invoke("setup:close"),
  openSetup: () => ipcRenderer.invoke("setup:open"),
});
