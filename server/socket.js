"use strict";

// Socket.IO: чат в реальном времени и присутствие в голосовых каналах.

const { z } = require("zod");
const { prisma } = require("./db");
const { getUserFromSocketCookie } = require("./auth");
const { PUBLIC_USER } = require("./api");
const { bus } = require("./bus");

const rooms = {}; // channelId -> [{ userId, name, avatarColor, muted }]

function attachSocket(io) {
  io.use(async (socket, nextMw) => {
    try {
      const user = await getUserFromSocketCookie(socket.handshake.headers.cookie);
      if (!user) return nextMw(new Error("unauthorized"));
      socket.data.user = user;
      nextMw();
    } catch (err) {
      nextMw(err);
    }
  });

  const channelRoom = (channelId) => `channel:${channelId}`;

  bus.on("guild-created", ({ userId }) => {
    io.to(`user:${userId}`).emit("guilds-changed");
  });

  io.on("connection", (socket) => {
    const user = socket.data.user;
    socket.join(`user:${user.id}`);

    const leaveVoice = (channelId) => {
      const list = rooms[channelId];
      if (list) {
        const idx = list.findIndex((p) => p.userId === user.id);
        if (idx >= 0) list.splice(idx, 1);
        if (list.length === 0) delete rooms[channelId];
      }
      io.to(channelRoom(channelId)).emit("voice-participants", {
        channelId,
        participants: rooms[channelId] || [],
      });
    };

    // Подписка на каналы всех серверов пользователя.
    socket.on("sync-guilds", async (_payload, ack) => {
      try {
        const members = await prisma.member.findMany({
          where: { userId: user.id },
          include: { guild: { include: { channels: { select: { id: true } } } } },
        });
        for (const m of members) {
          for (const ch of m.guild.channels) socket.join(channelRoom(ch.id));
        }
        if (typeof ack === "function") ack({ ok: true });
      } catch {
        if (typeof ack === "function") ack({ ok: false });
      }
    });

    // ----------------------------------------------------- чат
    socket.on("send-message", async (raw, ack) => {
      try {
        const body = z
          .object({
            channelId: z.string().min(1),
            content: z.string().trim().min(1).max(2000),
          })
          .parse(raw);

        const channel = await prisma.channel.findUnique({
          where: { id: body.channelId },
        });
        if (!channel || channel.type !== "text") {
          return ack && ack({ error: "Канал не найден" });
        }

        const member = await prisma.member.findFirst({
          where: { guildId: channel.guildId, userId: user.id },
        });
        if (!member) return ack && ack({ error: "Нет доступа" });

        const message = await prisma.message.create({
          data: {
            channelId: channel.id,
            authorId: user.id,
            content: body.content,
          },
          include: { author: { select: PUBLIC_USER } },
        });

        io.to(channelRoom(channel.id)).emit("new-message", message);
        if (typeof ack === "function") ack({ ok: true });
      } catch (err) {
        if (typeof ack === "function") {
          ack({ error: err instanceof Error ? err.message : "Ошибка" });
        }
      }
    });

    // ----------------------------------------------------- голос
    socket.on("voice-join", ({ channelId, muted } = {}, ack) => {
      if (typeof channelId !== "string") return ack && ack({ error: "bad" });
      const list = rooms[channelId] || (rooms[channelId] = []);
      const entry = {
        userId: user.id,
        name: user.displayName,
        avatarColor: user.avatarColor,
        muted: Boolean(muted),
      };
      const idx = list.findIndex((p) => p.userId === user.id);
      if (idx >= 0) list[idx] = entry;
      else list.push(entry);

      io.to(channelRoom(channelId)).emit("voice-participants", {
        channelId,
        participants: list,
      });
      if (typeof ack === "function") ack({ ok: true });
    });

    socket.on("voice-mute", ({ channelId, muted } = {}) => {
      const list = rooms[channelId];
      if (!list) return;
      const entry = list.find((p) => p.userId === user.id);
      if (!entry) return;
      entry.muted = Boolean(muted);
      io.to(channelRoom(channelId)).emit("voice-participants", {
        channelId,
        participants: list,
      });
    });

    socket.on("voice-leave", ({ channelId } = {}) => {
      if (typeof channelId === "string") leaveVoice(channelId);
    });

    socket.on("disconnect", () => {
      for (const channelId of Object.keys(rooms)) leaveVoice(channelId);
    });
  });
}

module.exports = { attachSocket, rooms };
