"use strict";

// Продакшен-запуск: Express (API на /api + страницы Next.js) + Socket.IO.
// Запуск: npm run build && npm run start
//
// Рассчитан на обычный хостинг с постоянным процессом (Render, VPS, Docker),
// потому что Socket.IO требует живого WebSocket-соединения.

const http = require("node:http");
const { parse: parseUrl } = require("node:url");
const express = require("express");
const next = require("next");
const { Server: SocketServer } = require("socket.io");
const { createApiRouter } = require("./api");
const { attachSocket, rooms } = require("./socket");
const { isLiveKitConfigured } = require("./livekit");

const port = Number(process.env.PORT || 3000);

async function main() {
  const nextApp = next({ dev: false, dir: process.cwd() });
  const nextHandler = nextApp.getRequestHandler();
  await nextApp.prepare();

  const app = express();

  // За прокси (Render, Caddy) — доверяем одному уровню: нужно для корректного
  // определения https и IP клиента (rate limiting, secure-cookies).
  app.set("trust proxy", 1);
  app.disable("x-powered-by");

  // 1) REST API по /api/*
  app.use("/api", createApiRouter({ rooms }));

  // 2) Всё остальное — страницы и статика Next.js
  app.use((req, res) => {
    nextHandler(req, res, parseUrl(req.url, true)).catch((err) => {
      console.error("[next]", err);
      if (!res.headersSent) res.status(500).send("Ошибка сервера");
    });
  });

  const server = http.createServer(app);
  const io = new SocketServer(server, { path: "/socket.io" });
  attachSocket(io);

  server.listen(port, "0.0.0.0", () => {
    const publicUrl =
      process.env.RENDER_EXTERNAL_URL ||
      process.env.PUBLIC_URL ||
      `http://localhost:${port}`;
    console.log(`\n  discord-lite → ${publicUrl} (порт ${port})`);
    console.log(
      `  LiveKit: ${isLiveKitConfigured() ? process.env.LIVEKIT_URL : "НЕ настроен (заполните .env)"}`
    );
    const dbMode = process.env.SQLITE_URL
      ? "локальная SQLite (режим разработки)"
      : process.env.DATABASE_URL
        ? "PostgreSQL по DATABASE_URL"
        : "НЕ настроена";
    console.log(`  База: ${dbMode}\n`);
  });

  // Render (и другие платформы) присылают SIGTERM при деплое — закрываемся аккуратно.
  const shutdown = (signal) => {
    console.log(`\n[${signal}] останавливаем сервер…`);
    io.close();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 8000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
