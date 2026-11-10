"use strict";

// Чистые функции конфигурации десктопного клиента.
// Вынесены отдельно, чтобы их можно было тестировать без Electron.

const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_SERVER = "http://localhost:3000";

/** Приводит введённый адрес к виду http(s)://host[:port] без хвостового слэша. */
function normalizeServerUrl(raw) {
  if (typeof raw !== "string") return "";
  let value = raw.trim();
  if (!value) return "";
  // Уже есть схема, но не http(s) — это не наш случай (ftp:, file: и т.п.).
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value) && !/^https?:\/\//i.test(value)) return "";
  if (!/^https?:\/\//i.test(value)) value = "http://" + value;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    if (!url.hostname) return "";
    // Отбрасываем путь и параметры: клиенту нужен только origin.
    const clean = `${url.protocol}//${url.host}`;
    return clean.replace(/\/+$/, "");
  } catch {
    return "";
  }
}

function isValidServerUrl(value) {
  return Boolean(normalizeServerUrl(value));
}

function configPath(userDataDir) {
  return path.join(userDataDir, "config.json");
}

function readConfig(userDataDir) {
  try {
    const raw = fs.readFileSync(configPath(userDataDir), "utf8");
    const parsed = JSON.parse(raw);
    return {
      serverUrl: normalizeServerUrl(parsed.serverUrl) || "",
      bounds: parsed.bounds && typeof parsed.bounds === "object" ? parsed.bounds : null,
    };
  } catch {
    return { serverUrl: "", bounds: null };
  }
}

function writeConfig(userDataDir, config) {
  fs.mkdirSync(userDataDir, { recursive: true });
  const data = {
    serverUrl: normalizeServerUrl(config.serverUrl) || "",
    bounds: config.bounds || null,
  };
  fs.writeFileSync(configPath(userDataDir), JSON.stringify(data, null, 2), "utf8");
  return data;
}

module.exports = {
  DEFAULT_SERVER,
  normalizeServerUrl,
  isValidServerUrl,
  readConfig,
  writeConfig,
  configPath,
};
