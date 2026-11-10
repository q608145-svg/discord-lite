"use strict";

// Отладка сессий: сюда пишется трассировка getUserFromRequest.
// Запуск: DEBUG_AUTH=1 npm start
const fs = require("node:fs");
const path = require("node:path");

const LOG = path.join(process.cwd(), "data", "auth-trace.log");

function trace(entry) {
  if (!process.env.DEBUG_AUTH) return;
  try {
    fs.mkdirSync(path.dirname(LOG), { recursive: true });
    fs.appendFileSync(LOG, `${new Date().toISOString()} ${entry}\n`);
  } catch {
    /* отладка не должна ронять приложение */
  }
}

module.exports = { trace, LOG };
