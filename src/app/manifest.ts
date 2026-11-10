import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "discord-lite — чат и голос для друзей",
    short_name: "discord-lite",
    description:
      "Свои серверы, текстовые каналы и голосовые комнаты на LiveKit. Ставится как приложение.",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    display_override: ["window-controls-overlay", "standalone", "minimal-ui"],
    orientation: "any",
    background_color: "#1e1f22",
    theme_color: "#5865F2",
    lang: "ru",
    dir: "ltr",
    categories: ["social", "communication"],
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    shortcuts: [
      {
        name: "Открыть чат",
        short_name: "Чат",
        url: "/",
        description: "Вернуться к последнему каналу",
      },
    ],
  };
}
