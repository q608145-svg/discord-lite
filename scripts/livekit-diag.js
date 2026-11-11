"use strict";

// Диагностика LiveKit Cloud: проверяем ключи через Twirp API и WebSocket /rtc.
// Запуск: LIVEKIT_URL=... LIVEKIT_API_KEY=... LIVEKIT_API_SECRET=... node scripts/livekit-diag.js

const { AccessToken } = require("livekit-server-sdk");

const url = (process.env.LIVEKIT_URL || "").replace(/\/$/, "");
const key = process.env.LIVEKIT_API_KEY;
const secret = process.env.LIVEKIT_API_SECRET;

if (!url || !key || !secret) {
  console.error("нужны LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET");
  process.exit(1);
}

const httpsUrl = url.replace(/^ws/, "http");

(async () => {
  console.log("URL:", url);

  // 1) Twirp: список комнат (нужен roomAdmin)
  const admin = new AccessToken(key, secret, { identity: "diag", ttl: "5m" });
  admin.addGrant({ roomAdmin: true, roomList: true, roomCreate: true });
  const adminJwt = await admin.toJwt();

  try {
    const res = await fetch(`${httpsUrl}/twirp/livekit.RoomService/ListRooms`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${adminJwt}`,
      },
      body: JSON.stringify({}),
    });
    const text = await res.text();
    console.log(`Twirp ListRooms → ${res.status} ${text.slice(0, 200)}`);
  } catch (err) {
    console.log("Twirp ошибка:", err.message);
  }

  // 2) WebSocket /rtc — то, что делает браузер
  const join = new AccessToken(key, secret, { identity: "diag-user", name: "Diag", ttl: "5m" });
  join.addGrant({ roomJoin: true, room: "diag-room", canPublish: true, canSubscribe: true });
  const joinJwt = await join.toJwt();

  const wsUrl =
    `${url}/rtc?access_token=${encodeURIComponent(joinJwt)}` +
    "&auto_subscribe=1&adaptive_stream=0&sdk=js&version=2.6.2&protocol=15";

  await new Promise((resolve) => {
    const ws = new WebSocket(wsUrl);
    const timer = setTimeout(() => {
      console.log("WebSocket: таймаут 12 c");
      ws.close();
      resolve();
    }, 12000);

    ws.addEventListener("open", () => console.log("WebSocket: открыт"));
    ws.addEventListener("message", (e) => {
      const size = typeof e.data === "string" ? e.data.length : e.data.byteLength;
      console.log(`WebSocket: ответ сервера ${size} байт — сигнализация работает`);
      clearTimeout(timer);
      ws.close();
      resolve();
    });
    ws.addEventListener("error", (e) => {
      console.log("WebSocket: error", e.message || e.type || "(без текста)");
    });
    ws.addEventListener("close", (e) => {
      console.log(`WebSocket: закрыт, код=${e.code} причина="${e.reason}"`);
      clearTimeout(timer);
      resolve();
    });
  });
})();
