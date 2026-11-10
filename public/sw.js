/* Service worker для discord-lite.
 * Кэшируем оболочку и статику, чтобы приложение открывалось без сети.
 * API и Socket.IO не кэшируем: чат и звонки всегда онлайн.
 */

const VERSION = "v1";
const SHELL_CACHE = `dl-shell-${VERSION}`;
const STATIC_CACHE = `dl-static-${VERSION}`;

const SHELL = [
  "/",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/maskable-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL))
      .catch(() => undefined)
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== SHELL_CACHE && key !== STATIC_CACHE)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

function isStaticAsset(url) {
  return (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/") ||
    /\.(?:png|jpg|jpeg|svg|webp|ico|woff2?|ttf)$/i.test(url.pathname)
  );
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response && response.status === 200) {
      const cache = await caches.open(SHELL_CACHE);
      cache.put("/", response.clone()).catch(() => undefined);
    }
    return response;
  } catch {
    const cached = await caches.match("/");
    if (cached) return cached;
    return new Response(
      "<h1>Нет сети</h1><p>Приложение откроется, как только появится интернет.</p>",
      { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } }
    );
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response && response.status === 200) {
    const cache = await caches.open(STATIC_CACHE);
    cache.put(request, response.clone()).catch(() => undefined);
  }
  return response;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Живые данные: всегда сеть.
  if (url.pathname.startsWith("/api") || url.pathname.startsWith("/socket.io")) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request));
    return;
  }

  if (isStaticAsset(url)) {
    event.respondWith(cacheFirst(request));
  }
});
