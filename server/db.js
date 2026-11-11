"use strict";

const globalForPrisma = globalThis;

/**
 * Клиент с устойчивостью к «моргающим» соединениям.
 *
 * Neon (и другие serverless-Postgres) периодически закрывает простаивающие
 * соединения. Prisma в этом случае кидает P1017 «Server has closed the connection»
 * и продолжает отдавать мёртвое соединение из пула. Поэтому при такой ошибке мы
 * пересоздаём клиент целиком и повторяем запрос.
 */

const TRANSIENT = /closed the connection|connection.*(lost|closed)|ECONNRESET|ETIMEDOUT/i;

function isTransient(err) {
  if (!err) return false;
  const code = err.code;
  if (code === "P1017" || code === "P1001" || code === "P1008") return true;
  return TRANSIENT.test(String(err.message || ""));
}

function makePostgresClient() {
  const { PrismaClient } = require("@prisma/client");
  return new PrismaClient({
    log: ["warn", "error"],
    datasources: process.env.DATABASE_URL
      ? { db: { url: process.env.DATABASE_URL } }
      : undefined,
  });
}

class ResilientPrisma {
  constructor(factory, { attempts = 3 } = {}) {
    this.factory = factory;
    this.client = factory();
    this.attempts = attempts;
  }

  async run(operation) {
    let lastError;
    for (let attempt = 1; attempt <= this.attempts; attempt++) {
      try {
        return await operation(this.client);
      } catch (err) {
        lastError = err;
        if (!isTransient(err) || attempt === this.attempts) throw err;
        console.warn(
          `[db] соединение потеряно (${err.code || "?"}), пересоздаю клиент (${attempt}/${this.attempts - 1})`
        );
        try {
          await this.client.$disconnect();
        } catch {
          /* старый клиент уже мёртв */
        }
        this.client = this.factory();
        await new Promise((resolve) => setTimeout(resolve, 200 * attempt));
      }
    }
    throw lastError;
  }
}

function createResilient() {
  const inner = new ResilientPrisma(makePostgresClient);

  // Прокси: prisma.user.findMany(...) → inner.run(c => c.user.findMany(...))
  return new Proxy(
    {},
    {
      get(_target, prop) {
        if (typeof prop !== "string") return undefined;

        // Служебные методы Prisma ($$queryRaw, $transaction и т.п.)
        if (prop.startsWith("$")) {
          return (...args) => inner.run((client) => client[prop](...args));
        }

        return new Proxy(
          {},
          {
            get(_modelTarget, method) {
              if (typeof method !== "string") return undefined;
              return (...args) =>
                inner.run((client) => {
                  const model = client[prop];
                  if (!model || typeof model[method] !== "function") {
                    throw new Error(`prisma.${prop}.${method} недоступен`);
                  }
                  return model[method](...args);
                });
            },
          }
        );
      },
    }
  );
}

function makeClient() {
  // Запуск без Postgres (локальная проверка): SQLITE_URL=file:./data/dev.db
  const localUrl = process.env.SQLITE_URL;
  if (localUrl) {
    const { MiniPrisma } = require("./local-db");
    console.warn("[db] SQLITE_URL задан → используется локальная SQLite (только для отладки)");
    return new MiniPrisma(localUrl.replace(/^file:/, ""));
  }

  return createResilient();
}

const prisma = globalForPrisma.__discordLitePrisma || makeClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.__discordLitePrisma = prisma;
}

module.exports = { prisma };
