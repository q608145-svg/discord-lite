// Сквозная проверка: REST + WebSocket (чат и голосовое присутствие).
// Запуск: node scripts/smoke.js [http://localhost:3141] [путь к socket.io-client]

const path = require("node:path");
const { Client } = require("./http-client");

const base = (process.argv[2] || "http://localhost:3141").replace(/\/$/, "");
const socketPath =
  process.argv[3] || path.join(__dirname, "..", "node_modules", "socket.io-client");
const { io } = require(socketPath);

let failed = 0;
function check(name, condition, extra = "") {
  if (condition) console.log("  ✓", name);
  else {
    failed++;
    console.log("  ✗", name, extra);
  }
}

(async () => {
  const client = new Client(base);
  const suffix = Date.now().toString().slice(-6);
  console.log("Проверка:", base);

  let r = await client.get("/api/health");
  check("GET /api/health", r.status === 200 && r.body.ok === true, JSON.stringify(r.body));

  r = await client.post("/api/auth/register", {
    username: "smoke" + suffix,
    displayName: "Тестовый " + suffix,
    password: "password123",
  });
  check("Регистрация и cookie", r.status === 201 && !!r.body.user.id, `${r.status} ${r.raw.slice(0, 120)}`);

  r = await client.get("/api/me");
  check("GET /api/me с сессией", r.status === 200 && !!r.body.user, r.raw.slice(0, 120));

  r = await client.post("/api/guilds", { name: "Сервер " + suffix });
  check("Создание сервера", r.status === 201 && !!r.body.guild, `${r.status} ${r.raw.slice(0, 160)}`);

  r = await client.get("/api/guilds");
  const guild = r.body && r.body.guilds && r.body.guilds[0];
  check("Список серверов", r.status === 200 && !!guild, r.raw.slice(0, 160));
  if (!guild) return finish();

  const text = guild.channels.find((c) => c.type === "text");
  const voice = guild.channels.find((c) => c.type === "voice");
  check("Каналы по умолчанию", !!text && !!voice);

  r = await client.get(`/api/channels/${text.id}/messages`);
  check("Пустая история", r.status === 200 && r.body.messages.length === 0, r.raw.slice(0, 120));

  // ---------------- голосовые токены
  r = await client.post("/api/voice/token", { channelId: text.id });
  check("Токен отклоняет текстовый канал", r.status === 400, r.raw.slice(0, 120));

  r = await client.post("/api/voice/token", { channelId: voice.id });
  const tokenLen = r.body && r.body.token ? r.body.token.length : 0;
  check("Токен для голосового канала", r.status === 200 && tokenLen > 40, `${r.status} tokenLen=${tokenLen}`);
  check("URL LiveKit передан клиенту", r.status === 200 && !!r.body.url, r.raw.slice(0, 120));

  // ---------------- WebSocket
  const socket = io(base, {
    path: "/socket.io",
    transports: ["websocket"],
    reconnection: false,
    extraHeaders: { Cookie: client.header() },
  });

  const connected = await new Promise((resolve) => {
    socket.on("connect", () => resolve(true));
    socket.on("connect_error", (err) => {
      console.log("    socket error:", err.message);
      resolve(false);
    });
  });
  check("Авторизованное соединение socket.io", connected);

  if (connected) {
    const ack = await new Promise((resolve) => {
      socket.emit("sync-guilds", null, resolve);
      setTimeout(() => resolve(null), 3000);
    });
    check("sync-guilds", !!ack && ack.ok === true, JSON.stringify(ack));

    const received = new Promise((resolve) => {
      socket.on("new-message", resolve);
      setTimeout(() => resolve(null), 4000);
    });
    const sendAck = await new Promise((resolve) => {
      socket.emit("send-message", { channelId: text.id, content: "Проверка чата" }, resolve);
      setTimeout(() => resolve(null), 4000);
    });
    check("Отправка сообщения", !!sendAck && sendAck.ok === true, JSON.stringify(sendAck));
    const msg = await received;
    check(
      "Доставка сообщения в реальном времени",
      !!msg && msg.content === "Проверка чата" && !!msg.author,
      JSON.stringify(msg && msg.content)
    );

    const presence = new Promise((resolve) => {
      socket.on("voice-participants", (payload) => {
        if (payload && payload.participants && payload.participants.length > 0) resolve(payload);
      });
      setTimeout(() => resolve(null), 4000);
    });
    socket.emit("voice-join", { channelId: voice.id, muted: false });
    const joined = await presence;
    check("Присутствие в голосовом канале", !!joined, JSON.stringify(joined));

    const left = new Promise((resolve) => {
      socket.on("voice-participants", (payload) => {
        if (payload && payload.participants && payload.participants.length === 0) resolve(payload);
      });
      setTimeout(() => resolve(null), 4000);
    });
    socket.emit("voice-leave", { channelId: voice.id });
    check("Выход из голосового канала", !!(await left));

    socket.close();
  }

  r = await client.get(`/api/channels/${text.id}/messages`);
  check(
    "Сообщение сохранилось в истории",
    r.status === 200 && r.body.messages.some((m) => m.content === "Проверка чата"),
    r.raw.slice(0, 120)
  );

  // ---------------- доступ: второй пользователь не должен видеть чужой сервер
  const other = new Client(base);
  r = await other.post("/api/auth/register", {
    username: "other" + suffix,
    displayName: "Чужой " + suffix,
    password: "password123",
  });
  check("Второй пользователь зарегистрирован", r.status === 201, String(r.status));

  r = await other.post(`/api/guilds/${guild.id}/channels`, { name: "x", type: "text" });
  check("Чужой сервер недоступен (403)", r.status === 403, String(r.status));

  r = await other.get(`/api/channels/${text.id}/messages`);
  check("Чужие сообщения недоступны (403)", r.status === 403, String(r.status));

  r = await client.post("/api/auth/logout");
  r = await client.get("/api/me");
  check("Выход из аккаунта", r.body.user === null);

  finish();
})().catch((err) => {
  console.error("Ошибка проверки:", err);
  process.exit(1);
});

function finish() {
  console.log(failed ? `\nПровалено: ${failed}` : "\nВсе проверки пройдены.");
  process.exit(failed ? 1 : 0);
}
