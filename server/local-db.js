"use strict";

// Локальная замена Prisma-клиента для проверки без Postgres.
// Использует встроенный SQLite (node:sqlite) и повторяет тот минимум API
// Prisma, который нужен приложению: user/session/guild/member/channel/message.

const crypto = require("node:crypto");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const ID_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";
function cuid() {
  return (
    Date.now().toString(36) +
    Array.from(crypto.randomBytes(16))
      .map((b) => ID_ALPHABET[b % 36])
      .join("")
  );
}

function nowIso() {
  return new Date().toISOString();
}

class MiniPrisma {
  constructor(file) {
    this.db = new DatabaseSync(path.resolve(file));
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec(SCHEMA_SQL);
  }

  _all(sql, params = []) {
    return this.db.prepare(sql).all(...params);
  }

  _get(sql, params = []) {
    return this.db.prepare(sql).get(...params) || null;
  }

  _run(sql, params = []) {
    return this.db.prepare(sql).run(...params);
  }

  // ------------------------------------------------------------ users
  get user() {
    const self = this;
    return {
      async findUnique({ where }) {
        if (!where) return null;
        const sql = where.id
          ? "SELECT * FROM User WHERE id = ?"
          : "SELECT * FROM User WHERE username = ?";
        return self._get(sql, [where.id ?? where.username]);
      },
      async upsert({ where, update, create }) {
        const existing = await this.findUnique({ where });
        if (existing) return existing;
        return this.create({ data: { ...create, ...update } });
      },
      async create({ data }) {
        const row = {
          id: data.id || cuid(),
          username: data.username,
          displayName: data.displayName,
          passwordHash: data.passwordHash,
          avatarColor: data.avatarColor || "#5865F2",
          createdAt: nowIso(),
        };
        self._run(
          "INSERT INTO User (id, username, displayName, passwordHash, avatarColor, createdAt) VALUES (?, ?, ?, ?, ?, ?)",
          [row.id, row.username, row.displayName, row.passwordHash, row.avatarColor, row.createdAt]
        );
        return row;
      },
    };
  }

  // ------------------------------------------------------------ sessions
  get session() {
    const self = this;
    return {
      async create({ data }) {
        const row = {
          id: data.id || cuid(),
          token: data.token,
          userId: data.userId,
          createdAt: nowIso(),
          expiresAt: data.expiresAt.toISOString(),
        };
        self._run(
          "INSERT INTO Session (id, token, userId, createdAt, expiresAt) VALUES (?, ?, ?, ?, ?)",
          [row.id, row.token, row.userId, row.createdAt, row.expiresAt]
        );
        return row;
      },
      async findUnique({ where, include }) {
        const row = self._get("SELECT * FROM Session WHERE id = ?", [where.id]);
        if (!row) return null;
        const session = { ...row, expiresAt: new Date(row.expiresAt) };
        if (include && include.user) {
          session.user = self._get("SELECT * FROM User WHERE id = ?", [row.userId]);
        }
        return session;
      },
    };
  }

  // ------------------------------------------------------------ guilds
  get guild() {
    const self = this;
    return {
      async findFirst({ where }) {
        if (where && where.name) {
          return self._get("SELECT * FROM Guild WHERE name = ? LIMIT 1", [where.name]);
        }
        return self._get("SELECT * FROM Guild ORDER BY createdAt ASC LIMIT 1");
      },
      async create({ data, include }) {
        const row = {
          id: cuid(),
          name: data.name,
          iconColor: data.iconColor || "#5865F2",
          ownerId: data.ownerId,
          createdAt: nowIso(),
        };
        self._run(
          "INSERT INTO Guild (id, name, iconColor, ownerId, createdAt) VALUES (?, ?, ?, ?, ?)",
          [row.id, row.name, row.iconColor, row.ownerId, row.createdAt]
        );

        const memberInputs = data.members?.create;
        const memberList = Array.isArray(memberInputs)
          ? memberInputs
          : memberInputs
            ? [memberInputs]
            : [];
        for (const member of memberList) {
          self._run("INSERT INTO Member (id, userId, guildId, joinedAt) VALUES (?, ?, ?, ?)", [
            cuid(), member.userId, row.id, nowIso(),
          ]);
        }

        const channelInputs = data.channels?.create;
        const channelList = Array.isArray(channelInputs)
          ? channelInputs
          : channelInputs
            ? [channelInputs]
            : [];
        for (const ch of channelList) {
          self._run(
            "INSERT INTO Channel (id, guildId, name, type, position, createdAt) VALUES (?, ?, ?, ?, ?, ?)",
            [cuid(), row.id, ch.name, ch.type || "text", ch.position || 0, nowIso()]
          );
        }

        if (include && include.channels) return { ...row, channels: self._channels(row.id) };
        return row;
      },
    };
  }

  // ------------------------------------------------------------ members
  get member() {
    const self = this;
    return {
      async create({ data }) {
        const row = {
          id: cuid(),
          userId: data.userId,
          guildId: data.guildId,
          joinedAt: nowIso(),
        };
        self._run(
          "INSERT OR IGNORE INTO Member (id, userId, guildId, joinedAt) VALUES (?, ?, ?, ?)",
          [row.id, row.userId, row.guildId, row.joinedAt]
        );
        return row;
      },
      async findFirst({ where }) {
        return self._get(
          "SELECT * FROM Member WHERE userId = ? AND guildId = ? LIMIT 1",
          [where.userId, where.guildId]
        );
      },
      async findMany({ where, include }) {
        const rows = self._all("SELECT * FROM Member WHERE userId = ? ORDER BY joinedAt ASC", [
          where.userId,
        ]);
        return rows.map((m) => {
          const guild = self._get("SELECT * FROM Guild WHERE id = ?", [m.guildId]);
          const out = { ...m, guild };
          if (include && include.guild) {
            const channels = self._channels(m.guildId);
            out.guild = {
              ...guild,
              channels,
              _count: { members: self._count("Member", m.guildId) },
            };
          }
          return out;
        });
      },
    };
  }

  // ------------------------------------------------------------ channels
  get channel() {
    const self = this;
    return {
      async findUnique({ where }) {
        return self._get("SELECT * FROM Channel WHERE id = ?", [where.id]);
      },
      async findFirst({ where, orderBy }) {
        const order = orderBy && orderBy.position === "desc" ? "DESC" : "ASC";
        return self._get(
          `SELECT * FROM Channel WHERE guildId = ? ORDER BY position ${order} LIMIT 1`,
          [where.guildId]
        );
      },
      async create({ data }) {
        const row = {
          id: cuid(),
          guildId: data.guildId,
          name: data.name,
          type: data.type || "text",
          position: data.position || 0,
          createdAt: nowIso(),
        };
        self._run(
          "INSERT INTO Channel (id, guildId, name, type, position, createdAt) VALUES (?, ?, ?, ?, ?, ?)",
          [row.id, row.guildId, row.name, row.type, row.position, row.createdAt]
        );
        return row;
      },
    };
  }

  // ------------------------------------------------------------ messages
  get message() {
    const self = this;
    return {
      async count({ where }) {
        const row = self._get("SELECT COUNT(*) AS c FROM Message WHERE channelId = ?", [
          where.channelId,
        ]);
        return Number(row.c);
      },
      async createMany({ data }) {
        for (const item of data) {
          self._run(
            "INSERT INTO Message (id, channelId, authorId, content, createdAt) VALUES (?, ?, ?, ?, ?)",
            [cuid(), item.channelId, item.authorId, item.content, nowIso()]
          );
        }
        return { count: data.length };
      },
      async findMany({ where, take, include }) {
        const rows = self._all(
          "SELECT * FROM Message WHERE channelId = ? ORDER BY createdAt DESC LIMIT ?",
          [where.channelId, take || 100]
        );
        return rows.map((m) => {
          const out = { ...m };
          if (include && include.author) {
            const author = self._get("SELECT id, username, displayName, avatarColor FROM User WHERE id = ?", [
              m.authorId,
            ]);
            out.author = author;
          }
          return out;
        });
      },
      async create({ data, include }) {
        const row = {
          id: cuid(),
          channelId: data.channelId,
          authorId: data.authorId,
          content: data.content,
          createdAt: nowIso(),
        };
        self._run(
          "INSERT INTO Message (id, channelId, authorId, content, createdAt) VALUES (?, ?, ?, ?, ?)",
          [row.id, row.channelId, row.authorId, row.content, row.createdAt]
        );
        const out = { ...row };
        if (include && include.author) {
          out.author = self._get(
            "SELECT id, username, displayName, avatarColor FROM User WHERE id = ?",
            [row.authorId]
          );
        }
        return out;
      },
    };
  }

  _channels(guildId) {
    return this._all("SELECT * FROM Channel WHERE guildId = ? ORDER BY position ASC", [guildId]);
  }

  _count(table, guildId) {
    const row = this._get(`SELECT COUNT(*) AS c FROM ${table} WHERE guildId = ?`, [guildId]);
    return Number(row.c);
  }

  async $disconnect() {
    this.db.close();
  }
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS User (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  displayName TEXT NOT NULL,
  passwordHash TEXT NOT NULL,
  avatarColor TEXT NOT NULL DEFAULT '#5865F2',
  createdAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS Session (
  id TEXT PRIMARY KEY,
  token TEXT NOT NULL UNIQUE,
  userId TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  expiresAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS Guild (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  iconColor TEXT NOT NULL DEFAULT '#5865F2',
  ownerId TEXT NOT NULL,
  createdAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS Member (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL,
  guildId TEXT NOT NULL,
  joinedAt TEXT NOT NULL,
  UNIQUE (userId, guildId)
);
CREATE TABLE IF NOT EXISTS Channel (
  id TEXT PRIMARY KEY,
  guildId TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'text',
  position INTEGER NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS Message (
  id TEXT PRIMARY KEY,
  channelId TEXT NOT NULL,
  authorId TEXT NOT NULL,
  content TEXT NOT NULL,
  createdAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS Message_channel ON Message(channelId, createdAt);
`;

module.exports = { MiniPrisma };
