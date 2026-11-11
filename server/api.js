"use strict";

// REST API. Монтируется в Express по пути /api (см. server/index.js).
// Зависимости: express, zod, bcryptjs, Prisma (или локальная SQLite).

const express = require("express");
const bcrypt = require("bcryptjs");
const { z } = require("zod");
const { prisma } = require("./db");
const {
  COOKIE_NAME,
  createSession,
  getUserFromRequest,
  sessionCookieOptions,
} = require("./auth");
const { createLiveKitToken, isLiveKitConfigured } = require("./livekit");
const { bus } = require("./bus");

const AVATAR_COLORS = [
  "#5865F2",
  "#EB459E",
  "#57F287",
  "#FEE75C",
  "#ED4245",
  "#3BA55D",
  "#9B59B6",
  "#E67E22",
];

const PUBLIC_USER = {
  id: true,
  username: true,
  displayName: true,
  avatarColor: true,
};

/**
 * @param {object} options
 * @param {Record<string, Array<{ userId: string }>>} options.rooms
 *        присутствие в голосовых каналах (channelId -> участники)
 */
function createApiRouter({ rooms }) {
  const api = express.Router();

  api.use(express.json({ limit: "256kb" }));

  // req.user — объект пользователя или null.
  api.use(async (req, _res, next) => {
    try {
      req.user = await getUserFromRequest(req);
    } catch {
      req.user = null;
    }
    next();
  });

  const requireAuth = (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: "Не авторизован" });
    next();
  };

  api.get("/health", (_req, res) =>
    res.json({ ok: true, livekit: isLiveKitConfigured() })
  );

  // ------------------------------------------------------------- auth
  api.post("/auth/register", async (req, res) => {
    const body = z
      .object({
        username: z
          .string()
          .min(2)
          .max(24)
          .regex(/^[a-zA-Z0-9_.]+$/, "Только латиница, цифры, _ и ."),
        displayName: z.string().trim().min(1).max(32),
        password: z.string().min(6).max(72),
      })
      .parse(req.body);

    const login = body.username.toLowerCase();
    if (await prisma.user.findUnique({ where: { username: login } })) {
      return res.status(409).json({ error: "Такой логин занят" });
    }

    const user = await prisma.user.create({
      data: {
        username: login,
        displayName: body.displayName,
        passwordHash: await bcrypt.hash(body.password, 10),
        avatarColor: AVATAR_COLORS[(Math.random() * AVATAR_COLORS.length) | 0],
      },
      select: PUBLIC_USER,
    });

    res.cookie(COOKIE_NAME, await createSession(user.id), sessionCookieOptions());
    res.status(201).json({ user });
  });

  api.post("/auth/login", async (req, res) => {
    const body = z
      .object({ username: z.string().min(1), password: z.string().min(1) })
      .parse(req.body);

    const user = await prisma.user.findUnique({
      where: { username: body.username.trim().toLowerCase() },
    });
    if (!user || !(await bcrypt.compare(body.password, user.passwordHash))) {
      return res.status(401).json({ error: "Неверный логин или пароль" });
    }

    res.cookie(COOKIE_NAME, await createSession(user.id), sessionCookieOptions());
    res.json({
      user: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        avatarColor: user.avatarColor,
      },
    });
  });

  api.post("/auth/logout", (_req, res) => {
    res.clearCookie(COOKIE_NAME, { path: "/" });
    res.json({ ok: true });
  });

  api.get("/me", (req, res) => {
    res.json({ user: req.user || null });
  });

  // ----------------------------------------------------------- guilds
  api.get("/guilds", requireAuth, async (req, res) => {
    // Несколько простых запросов вместо одного «тяжёлого» include:
    // так меньше работы внутри одной транзакции и устойчивее к обрывам связи.
    const memberships = await prisma.member.findMany({
      where: { userId: req.user.id },
      orderBy: { joinedAt: "asc" },
    });

    const guildIds = memberships.map((m) => m.guildId);
    if (guildIds.length === 0) return res.json({ guilds: [] });

    const [guilds, channels, allMembers] = await Promise.all([
      prisma.guild.findMany({ where: { id: { in: guildIds } } }),
      prisma.channel.findMany({
        where: { guildId: { in: guildIds } },
        orderBy: { position: "asc" },
      }),
      prisma.member.findMany({
        where: { guildId: { in: guildIds } },
        select: { guildId: true },
      }),
    ]);

    const channelsByGuild = new Map();
    for (const channel of channels) {
      const list = channelsByGuild.get(channel.guildId) || [];
      list.push(channel);
      channelsByGuild.set(channel.guildId, list);
    }

    const memberCounts = new Map();
    for (const member of allMembers) {
      memberCounts.set(member.guildId, (memberCounts.get(member.guildId) || 0) + 1);
    }

    const byId = new Map(guilds.map((g) => [g.id, g]));
    res.json({
      guilds: memberships
        .map((m) => byId.get(m.guildId))
        .filter(Boolean)
        .map((guild) => ({
          id: guild.id,
          name: guild.name,
          iconColor: guild.iconColor,
          ownerId: guild.ownerId,
          memberCount: memberCounts.get(guild.id) || 0,
          channels: channelsByGuild.get(guild.id) || [],
        })),
    });
  });

  api.post("/guilds", requireAuth, async (req, res) => {
    const body = z.object({ name: z.string().trim().min(1).max(48) }).parse(req.body);

    const iconColor = AVATAR_COLORS[(Math.random() * AVATAR_COLORS.length) | 0];

    // Создаём последовательными запросами, а не вложенной записью: так меньше
    // транзакционной работы, и каждый шаг можно безопасно повторить при обрыве
    // соединения (актуально для serverless-Postgres вроде Neon).
    const guild = await prisma.guild.create({
      data: { name: body.name, ownerId: req.user.id, iconColor },
    });

    try {
      await prisma.member.create({ data: { userId: req.user.id, guildId: guild.id } });
      await prisma.channel.createMany({
        data: [
          { guildId: guild.id, name: "общий", type: "text", position: 0 },
          { guildId: guild.id, name: "Общий голосовой", type: "voice", position: 1 },
        ],
      });
    } catch (err) {
      // Не оставляем «пустой» сервер без каналов.
      await prisma.guild.delete({ where: { id: guild.id } }).catch(() => {});
      throw err;
    }

    const channels = await prisma.channel.findMany({
      where: { guildId: guild.id },
      orderBy: { position: "asc" },
    });

    bus.emit("guild-created", { userId: req.user.id });
    res.status(201).json({ guild: { ...guild, channels } });
  });

  api.post("/guilds/:guildId/channels", requireAuth, async (req, res) => {
    const body = z
      .object({
        name: z.string().trim().min(1).max(32),
        type: z.enum(["text", "voice"]).default("text"),
      })
      .parse(req.body);

    const member = await prisma.member.findFirst({
      where: { guildId: req.params.guildId, userId: req.user.id },
    });
    if (!member) return res.status(403).json({ error: "Нет доступа" });

    const last = await prisma.channel.findFirst({
      where: { guildId: req.params.guildId },
      orderBy: { position: "desc" },
    });

    const channel = await prisma.channel.create({
      data: {
        guildId: req.params.guildId,
        name: body.name,
        type: body.type,
        position: (last ? last.position : -1) + 1,
      },
    });

    res.status(201).json({ channel });
  });

  // ---------------------------------------------------------- messages
  api.get("/channels/:channelId/messages", requireAuth, async (req, res) => {
    const channel = await prisma.channel.findUnique({
      where: { id: req.params.channelId },
    });
    if (!channel) return res.status(404).json({ error: "Канал не найден" });

    const member = await prisma.member.findFirst({
      where: { guildId: channel.guildId, userId: req.user.id },
    });
    if (!member) return res.status(403).json({ error: "Нет доступа" });

    const messages = await prisma.message.findMany({
      where: { channelId: channel.id },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { author: { select: PUBLIC_USER } },
    });

    res.json({ messages: messages.reverse() });
  });

  // ------------------------------------------------------------- voice
  api.post("/voice/token", requireAuth, async (req, res) => {
    const body = z.object({ channelId: z.string().min(1) }).parse(req.body);

    const channel = await prisma.channel.findUnique({
      where: { id: body.channelId },
    });
    if (!channel) return res.status(404).json({ error: "Канал не найден" });
    if (channel.type !== "voice") {
      return res.status(400).json({ error: "Это не голосовой канал" });
    }

    const member = await prisma.member.findFirst({
      where: { guildId: channel.guildId, userId: req.user.id },
    });
    if (!member) return res.status(403).json({ error: "Нет доступа" });

    const token = await createLiveKitToken({ channelId: channel.id, user: req.user });
    res.json({
      token,
      url: process.env.LIVEKIT_URL || "",
      room: channel.id,
      voiceChannelName: channel.name,
    });
  });

  api.get("/voice/:channelId/participants", requireAuth, (req, res) => {
    res.json({ participants: rooms[req.params.channelId] || [] });
  });

  // Ошибки API: zod → 400, битый JSON → 400, остальное → 500.
  api.use((err, _req, res, _next) => {
    if (res.headersSent) return;
    if (err && (err.name === "ZodError" || Array.isArray(err.issues))) {
      const issue = (err.issues && err.issues[0]) || {};
      const field = Array.isArray(issue.path) ? issue.path.join(".") : "";
      return res.status(400).json({
        error: `Проверьте поле ${field || "запроса"}: ${issue.message || "неверно"}`,
      });
    }
    if (err && err.type === "entity.parse.failed") {
      return res.status(400).json({ error: "Некорректный JSON" });
    }
    console.error("[api]", err);
    res.status(500).json({ error: "Внутренняя ошибка сервера" });
  });

  // Express 4 не ловит исключения из async-обработчиков — оборачиваем вручную,
  // иначе любой reject превращается в unhandledRejection и «зависший» запрос.
  const wrap = (fn) => (req, res, next) => {
    try {
      const result = fn(req, res, next);
      if (result && typeof result.then === "function") result.catch(next);
    } catch (err) {
      next(err);
    }
  };

  for (const layer of api.stack) {
    if (layer.route) {
      for (const inner of layer.route.stack) {
        if (typeof inner.handle === "function" && inner.handle.length < 4) {
          inner.handle = wrap(inner.handle);
        }
      }
    } else if (typeof layer.handle === "function" && layer.handle.length < 4) {
      layer.handle = wrap(layer.handle);
    }
  }

  return api;
}

module.exports = { createApiRouter, PUBLIC_USER, AVATAR_COLORS };
