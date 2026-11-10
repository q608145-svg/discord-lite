"use strict";

// Готовит демо-аккаунт с сервером, сообщениями и участником в голосовом канале.
// Печатает значение cookie dl_session в stdout.
// Запуск: node scripts/demo-account.js http://localhost:3141

const path = require("node:path");
const { io } = require(path.join(process.cwd(), "node_modules", "socket.io-client"));

const base = (process.argv[2] || "http://localhost:3141").replace(/\/$/, "");

async function api(path, { method = "GET", body, cookie } = {}) {
  const res = await fetch(base + "/api" + path, {
    method,
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, body: json, headers: res.headers };
}

async function register(username, displayName) {
  const res = await api("/auth/register", {
    method: "POST",
    body: { username, displayName, password: "password123" },
  });
  if (res.status !== 201) throw new Error("register: " + JSON.stringify(res.body));
  return (res.headers.getSetCookie() || [])[0].split(";")[0];
}

function connect(cookie) {
  return new Promise((resolve, reject) => {
    const socket = io(base, {
      path: "/socket.io",
      transports: ["websocket"],
      extraHeaders: { Cookie: cookie },
      reconnection: false,
    });
    socket.on("connect", () => resolve(socket));
    socket.on("connect_error", reject);
  });
}

(async () => {
  const suffix = Math.random().toString(36).slice(2, 6);

  const demoCookie = await register("demo_" + suffix, "Вася");
  const friendCookie = await register("friend_" + suffix, "Аня");

  await api("/guilds", { method: "POST", body: { name: "Друзья" }, cookie: demoCookie });

  const demoGuilds = await api("/guilds", { cookie: demoCookie });
  const guild = demoGuilds.body.guilds[0];
  const text = guild.channels.find((c) => c.type === "text");
  const voice = guild.channels.find((c) => c.type === "voice");

  await api(`/guilds/${guild.id}/channels`, {
    method: "POST",
    body: { name: "мемы", type: "text" },
    cookie: demoCookie,
  });
  await api(`/guilds/${guild.id}/channels`, {
    method: "POST",
    body: { name: "Игры", type: "voice" },
    cookie: demoCookie,
  });

  // Второй участник должен попасть в сервер (прямого инвайта пока нет).
  // Если приложение работает на SQLite — используем ту же базу.
  const fs = require("node:fs");
  if (!process.env.SQLITE_URL && fs.existsSync(path.join(process.cwd(), "data", "dev.db"))) {
    process.env.SQLITE_URL = "file:./data/dev.db";
  }
  const { prisma } = require(path.join(process.cwd(), "server", "db"));
  const friend = await prisma.user.findUnique({
    where: { username: ("friend_" + suffix).toLowerCase() },
  });
  await prisma.member.create({ data: { userId: friend.id, guildId: guild.id } });

  const demoSocket = await connect(demoCookie);
  const friendSocket = await connect(friendCookie);

  const send = (socket, content) =>
    new Promise((resolve) =>
      socket.emit("send-message", { channelId: text.id, content }, resolve)
    );

  await send(demoSocket, "Всем привет! Переехали с дискорда 🙂");
  await send(friendSocket, "О, тут и звонки работают?");
  await send(demoSocket, "Ага, заходи в «Общий голосовой» — проверим связь");
  await send(friendSocket, "Уже иду");

  // Друг заходит в голосовой канал — в списке канала появится участник.
  friendSocket.emit("voice-join", { channelId: voice.id, muted: false });
  await new Promise((r) => setTimeout(r, 500));

  console.log(demoCookie.slice("dl_session=".length));

  // Не выходим сразу: даём серверу обработать события, потом отключаем сокеты.
  setTimeout(() => {
    demoSocket.close();
    friendSocket.close();
    process.exit(0);
  }, 800);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
