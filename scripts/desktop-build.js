"use strict";

// Сборка Windows-приложения (установщик + portable).
//
// Зачем свой скрипт: electron-builder при сборке NSIS скачивает архив winCodeSign,
// внутри которого лежат macOS-симлинки. На Windows без прав администратора 7-Zip
// не может их создать и сборка падает. Здесь мы один раз готовим «очищенный»
// архив (без darwin) и подсовываем его electron-builder через локальное зеркало.
//
// Запуск: npm run desktop:build

const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const CACHE = path.join(ROOT, ".eb-cache");
const SEVEN_ZIP = path.join(ROOT, "node_modules", "7zip-bin", "win", "x64", "7za.exe");
const SANITIZED = path.join(CACHE, "winCodeSign-2.6.0.7z");
const MIRROR_PATH = "/winCodeSign-2.6.0/winCodeSign-2.6.0.7z";

function log(message) {
  console.log(`[desktop:build] ${message}`);
}

function findOriginalArchive() {
  const dir = path.join(CACHE, "winCodeSign");
  if (!fs.existsSync(dir)) return null;
  const files = fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".7z"))
    .map((name) => path.join(dir, name));
  return files[0] || null;
}

function prepareSanitizedArchive() {
  if (fs.existsSync(SANITIZED)) {
    log("очищенный winCodeSign уже готов");
    return;
  }

  const original = findOriginalArchive();
  if (!original) {
    log("не нашёл исходный архив winCodeSign — сборка сама скачает его и упадёт");
    return;
  }

  const workDir = path.join(CACHE, "winCodeSign-src");
  fs.rmSync(workDir, { recursive: true, force: true });
  fs.mkdirSync(workDir, { recursive: true });

  log("распаковываю winCodeSign без macOS-симлинков…");
  const unpack = spawnSync(
    SEVEN_ZIP,
    ["x", original, `-o${workDir}`, "-xr!darwin", "-y"],
    { stdio: "inherit" }
  );
  if (unpack.status !== 0) throw new Error("не удалось распаковать winCodeSign");

  log("собираю архив заново…");
  const pack = spawnSync(
    SEVEN_ZIP,
    ["a", "-t7z", SANITIZED, path.join(workDir, "*")],
    { stdio: "inherit", cwd: workDir }
  );
  if (pack.status !== 0) throw new Error("не удалось собрать архив");
  fs.rmSync(workDir, { recursive: true, force: true });
  log("готово: " + path.relative(ROOT, SANITIZED));
}

function startMirror() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (req.url !== MIRROR_PATH) {
        res.statusCode = 404;
        res.end("not found");
        return;
      }
      const stat = fs.statSync(SANITIZED);
      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader("Content-Length", String(stat.size));
      fs.createReadStream(SANITIZED).pipe(res);
    });

    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ server, port });
    });
  });
}

(async () => {
  // Иконку и версию правит afterPack на чистом JS (resedit), поэтому
  // winCodeSign и rcedit из electron-builder не нужны.
  void prepareSanitizedArchive;
  void startMirror;

  // NSIS (makensis) не умеет создавать временные файлы в системном TEMP
  // на этой машине — даём ему отдельный каталог внутри проекта.
  const tmpDir = path.join(ROOT, ".tmp-build");
  fs.mkdirSync(tmpDir, { recursive: true });

  const env = {
    ...process.env,
    CSC_IDENTITY_AUTO_DISCOVERY: "false",
    ELECTRON_BUILDER_CACHE: CACHE,
    TEMP: tmpDir,
    TMP: tmpDir,
  };

  const builder = path.join(
    ROOT,
    "node_modules",
    "electron-builder",
    "out",
    "cli",
    "cli.js"
  );

  const child = spawn(
    process.execPath,
    [builder, "--win", "--config", "electron-builder.yml"],
    { cwd: ROOT, env, stdio: "inherit" }
  );

  child.on("exit", (code) => {
    process.exit(code == null ? 1 : code);
  });
})().catch((err) => {
  console.error("[desktop:build] ошибка:", err);
  process.exit(1);
});
