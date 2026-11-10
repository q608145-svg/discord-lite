"use strict";

// Тесты чистых функций десктопного клиента (без Electron).
// Запуск: node scripts/desktop-test.js

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  normalizeServerUrl,
  isValidServerUrl,
  readConfig,
  writeConfig,
  configPath,
} = require("../desktop/config");

let failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log("  ✓", name);
  } catch (err) {
    failed++;
    console.log("  ✗", name, "-", err.message);
  }
}

console.log("Проверка десктопного клиента:");

test("normalizeServerUrl: http с портом", () => {
  assert.equal(normalizeServerUrl("http://localhost:3000"), "http://localhost:3000");
});

test("normalizeServerUrl: добавляет схему", () => {
  assert.equal(normalizeServerUrl("chat.example.com"), "http://chat.example.com");
});

test("normalizeServerUrl: убирает хвостовой слэш и путь", () => {
  assert.equal(normalizeServerUrl("https://chat.example.com/app/"), "https://chat.example.com");
});

test("normalizeServerUrl: пробелы и пустое значение", () => {
  assert.equal(normalizeServerUrl("   "), "");
  assert.equal(normalizeServerUrl(null), "");
});

test("normalizeServerUrl: мусор отклоняется", () => {
  assert.equal(normalizeServerUrl("не адрес"), "");
  assert.equal(normalizeServerUrl("ftp://example.com"), "");
});

test("isValidServerUrl", () => {
  assert.equal(isValidServerUrl("http://localhost:3000"), true);
  assert.equal(isValidServerUrl(""), false);
});

test("конфиг: запись и чтение", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dl-config-"));
  writeConfig(dir, { serverUrl: "http://localhost:3000/", bounds: { width: 1200, height: 800 } });
  const loaded = readConfig(dir);
  assert.equal(loaded.serverUrl, "http://localhost:3000");
  assert.equal(loaded.bounds.width, 1200);
  assert.ok(fs.existsSync(configPath(dir)));
  fs.rmSync(dir, { recursive: true, force: true });
});

test("конфиг: битый файл не роняет приложение", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dl-config-"));
  fs.writeFileSync(path.join(dir, "config.json"), "{не json", "utf8");
  const loaded = readConfig(dir);
  assert.equal(loaded.serverUrl, "");
  assert.equal(loaded.bounds, null);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("main.js содержит ключевые настройки окна", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "desktop", "main.js"), "utf8");
  assert.match(src, /titleBarOverlay/);
  assert.match(src, /setPermissionRequestHandler/);
  assert.match(src, /setDisplayMediaRequestHandler/);
  assert.match(src, /contextIsolation: true/);
  assert.match(src, /nodeIntegration: false/);
  assert.match(src, /requestSingleInstanceLock/);
});

test("electron-builder.yml собирает установщик и portable", () => {
  const yml = fs.readFileSync(path.join(__dirname, "..", "electron-builder.yml"), "utf8");
  assert.match(yml, /nsis/);
  assert.match(yml, /portable/);
  assert.match(yml, /icon\.ico/);
  assert.ok(yml.includes("node_modules"));
});

console.log(failed ? `\nПровалено: ${failed}` : "\nЛогика десктопного клиента в порядке.");
process.exit(failed ? 1 : 0);
