"use strict";

// Инициализация схемы БД без Prisma schema engine.
//
// Зачем: `prisma db push`/`migrate deploy` используют отдельный бинарник, который
// на Neon может падать с P1017 «Server has closed the connection» (SSL/канал-биндинг).
// Prisma Client к той же базе подключается нормально, поэтому DDL применяем через него.
//
// Скрипт идемпотентный: IF NOT EXISTS + проверки в pg_constraint, можно запускать
// на каждом деплое. Запуск: node scripts/db-init.js

const { PrismaClient } = require("@prisma/client");

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL не задан — нечего инициализировать");
  process.exit(1);
}

const STATEMENTS = [
  // ---------------------------------------------------------------- таблицы
  `CREATE TABLE IF NOT EXISTS "User" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "avatarColor" TEXT NOT NULL DEFAULT '#5865F2',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE TABLE IF NOT EXISTS "Session" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE TABLE IF NOT EXISTS "Guild" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "iconColor" TEXT NOT NULL DEFAULT '#5865F2',
    "ownerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Guild_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE TABLE IF NOT EXISTS "Member" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Member_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE TABLE IF NOT EXISTS "Channel" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'text',
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Channel_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE TABLE IF NOT EXISTS "Message" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
  )`,

  // ---------------------------------------------------------------- индексы
  `CREATE UNIQUE INDEX IF NOT EXISTS "User_username_key" ON "User"("username")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "Session_token_key" ON "Session"("token")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "Member_userId_guildId_key" ON "Member"("userId", "guildId")`,
  `CREATE INDEX IF NOT EXISTS "Member_guildId_idx" ON "Member"("guildId")`,
  `CREATE INDEX IF NOT EXISTS "Channel_guildId_idx" ON "Channel"("guildId")`,
  `CREATE INDEX IF NOT EXISTS "Message_channelId_createdAt_idx" ON "Message"("channelId", "createdAt")`,

  // ---------------------------------------------------------------- внешние ключи
  ...foreignKey(
    "Session_userId_fkey",
    "Session",
    "userId",
    "User",
    "id"
  ),
  ...foreignKey("Member_userId_fkey", "Member", "userId", "User", "id"),
  ...foreignKey("Member_guildId_fkey", "Member", "guildId", "Guild", "id"),
  ...foreignKey("Channel_guildId_fkey", "Channel", "guildId", "Guild", "id"),
  ...foreignKey("Message_channelId_fkey", "Message", "channelId", "Channel", "id"),
  ...foreignKey("Message_authorId_fkey", "Message", "authorId", "User", "id"),
];

function foreignKey(name, table, column, refTable, refColumn) {
  return [
    `DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '${name}') THEN
        ALTER TABLE "${table}" ADD CONSTRAINT "${name}"
          FOREIGN KEY ("${column}") REFERENCES "${refTable}"("${refColumn}")
          ON DELETE CASCADE ON UPDATE CASCADE;
      END IF;
    END
    $$;`,
  ];
}

(async () => {
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  // Neon может закрыть первое соединение после «сна» — повторяем с паузой.
  const withRetry = async (label, fn, attempts = 5) => {
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        return await fn();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const retryable = /closed the connection|P1017|P1001|timed out/i.test(message);
        if (!retryable || attempt === attempts) throw err;
        console.log(`  ${label}: ${message.split("\\n")[0]} — повтор ${attempt}/${attempts - 1}`);
        await new Promise((r) => setTimeout(r, 1500 * attempt));
      }
    }
    return undefined;
  };

  try {
    console.log("Инициализация схемы…");
    let index = 0;
    for (const statement of STATEMENTS) {
      index++;
      const label = `DDL ${index}/${STATEMENTS.length}`;
      await withRetry(label, () => prisma.$executeRawUnsafe(statement));
    }

    const tables = await withRetry("проверка таблиц", () =>
      prisma.$queryRawUnsafe(
        "select table_name from information_schema.tables where table_schema = 'public' order by table_name"
      )
    );
    const indexes = await withRetry("проверка индексов", () =>
      prisma.$queryRawUnsafe(
        "select indexname from pg_indexes where schemaname = 'public'"
      )
    );
    const keys = await withRetry("проверка внешних ключей", () =>
      prisma.$queryRawUnsafe(
        "select conname from pg_constraint where contype = 'f' and connamespace = 'public'::regnamespace"
      )
    );

    const tableNames = tables.map((t) => t.table_name);
    const expectedTables = ["Channel", "Guild", "Member", "Message", "Session", "User"];
    const missingTables = expectedTables.filter((name) => !tableNames.includes(name));

    console.log(`  таблицы: ${tableNames.join(", ") || "(нет)"}`);
    console.log(`  индексы: ${indexes.length}, внешние ключи: ${keys.length}`);

    if (missingTables.length > 0) {
      throw new Error(`не созданы таблицы: ${missingTables.join(", ")}`);
    }
    if (indexes.length < 12) {
      throw new Error(`индексов ${indexes.length}, ожидалось 12`);
    }
    if (keys.length < 6) {
      throw new Error(`внешних ключей ${keys.length}, ожидалось 6`);
    }

    console.log("Схема готова.");
  } catch (err) {
    console.error("Ошибка инициализации:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
})();
