"use strict";

// Зашивает адрес сервера в десктопное приложение и собирает .exe.
//
//   npm run desktop:bake -- https://discord-lite-xxxx.onrender.com
//   npm run desktop:bake -- --clear        # убрать адрес и вернуть экран настройки
//
// Скрипт пишет desktop/server.json (он попадает внутрь app.asar) и запускает
// сборку установщика и portable-версии.

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const { normalizeServerUrl } = require("../desktop/config");

const ROOT = path.resolve(__dirname, "..");
const SERVER_FILE = path.join(ROOT, "desktop", "server.json");
const args = process.argv.slice(2);
const clear = args.includes("--clear");
const skipBuild = args.includes("--no-build");
const rawUrl = args.find((a) => !a.startsWith("--")) || process.env.BUNDLED_SERVER_URL || "";

function log(message) {
  console.log(`[bake] ${message}`);
}

if (clear) {
  fs.rmSync(SERVER_FILE, { force: true });
  log("адрес сервера убран — приложение покажет экран подключения");
} else {
  const url = normalizeServerUrl(rawUrl);
  if (!url) {
    console.error(
      "[bake] нужен корректный адрес, например:\n  npm run desktop:bake -- https://discord-lite-xxxx.onrender.com"
    );
    process.exit(1);
  }

  fs.writeFileSync(
    SERVER_FILE,
    JSON.stringify({ serverUrl: url, bakedAt: new Date().toISOString() }, null, 2) + "\n",
    "utf8"
  );
  log(`адрес зашит: ${url}`);
  log(`файл: ${path.relative(ROOT, SERVER_FILE)}`);
}

if (skipBuild) {
  log("сборка пропущена (--no-build)");
  process.exit(0);
}

log("собираю .exe…");
const result = spawnSync(process.execPath, [path.join(ROOT, "scripts", "desktop-build.js")], {
  cwd: ROOT,
  stdio: "inherit",
});

if (result.status !== 0) {
  console.error("[bake] сборка не удалась");
  process.exit(result.status || 1);
}

const outDir = path.join(ROOT, "dist-desktop");
const artifacts = fs.existsSync(outDir)
  ? fs
      .readdirSync(outDir)
      .filter((name) => name.endsWith(".exe"))
      .map((name) => {
        const size = fs.statSync(path.join(outDir, name)).size;
        return `${name} — ${(size / 1048576).toFixed(1)} МБ`;
      })
  : [];

log("готово:");
for (const artifact of artifacts) console.log("  " + artifact);
