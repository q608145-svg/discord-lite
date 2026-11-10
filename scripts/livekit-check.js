"use strict";

// Проверка локального LiveKit «как это делает браузер»:
// 1) выпускаем токен так же, как /api/voice/token;
// 2) открываем WebSocket на /rtc с этим токеном;
// 3) ждём первое бинарное сообщение от сервера (JoinResponse).
//
// Запуск: node scripts/livekit-check.js [ws://localhost:7880] [room]

const { createLiveKitToken } = require("../server/livekit");

// Подхватываем .env, если скрипт запускают без next/--env-file.
try {
  process.loadEnvFile(".env");
} catch {
  /* .env может отсутствовать — тогда берём переменные окружения */
}

const url = process.argv[2] || process.env.LIVEKIT_URL || "ws://localhost:7880";
const room = process.argv[3] || "check-room-" + Date.now().toString(36);

(async () => {
  const token = await createLiveKitToken({
    channelId: room,
    user: {
      id: "check-user",
      displayName: "Проверка",
      username: "check",
      avatarColor: "#5865F2",
    },
  });

  const wsUrl =
    url.replace(/^http/, "ws") +
    `/rtc?access_token=${encodeURIComponent(token)}` +
    "&auto_subscribe=1&adaptive_stream=0&sdk=js&version=2.6.2&protocol=15";

  console.log("Подключаюсь:", url, "→ комната", room);

  await new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error("таймаут: сервер не ответил за 10 секунд"));
    }, 10000);

    ws.addEventListener("open", () => console.log("  ✓ WebSocket открыт"));
    ws.addEventListener("message", (event) => {
      const size = typeof event.data === "string" ? event.data.length : event.data.byteLength;
      console.log(`  ✓ ответ сервера на /rtc (${size} байт) — сигнализация работает`);
      clearTimeout(timer);
      ws.close();
      resolve();
    });
    ws.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("не удалось открыть WebSocket — LiveKit не запущен или другой порт"));
    });
    ws.addEventListener("close", (e) => {
      if (e.code !== 1000 && e.code !== 1005) {
        clearTimeout(timer);
        // 1000/1005 — нормальное закрытие после ответа.
      }
    });
  });

  console.log("\nLiveKit готов: звук в приложении должен работать.");
})().catch((err) => {
  console.error("\nОшибка:", err.message);
  process.exit(1);
});
