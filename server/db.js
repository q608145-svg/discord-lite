"use strict";

const globalForPrisma = globalThis;

function makeClient() {
  // Запуск без Postgres (локальная проверка):
  // SQLITE_URL=file:./data/dev.db npm start
  // Используется встроенный в Node.js SQLite — нативные модули не нужны.
  const localUrl = process.env.SQLITE_URL;
  if (localUrl) {
    const { MiniPrisma } = require("./local-db");
    console.warn("[db] SQLITE_URL задан → используется локальная SQLite (только для отладки)");
    return new MiniPrisma(localUrl.replace(/^file:/, ""));
  }

  const { PrismaClient } = require("@prisma/client");
  return new PrismaClient({ log: ["warn", "error"] });
}

const prisma = globalForPrisma.__discordLitePrisma || makeClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.__discordLitePrisma = prisma;
}

module.exports = { prisma };
