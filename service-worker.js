const CACHE_NAME = "xcar-cache-v5";
const ASSETS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ---------- push-уведомления (когда действие выполнено на другом устройстве) ----------
self.addEventListener("push", (event) => {
  let data = { title: "XCAR", body: "Есть обновление" };
  try {
    if (event.data) data = Object.assign(data, event.data.json());
  } catch (e) {
    if (event.data) data.body = event.data.text();
  }
  // у каждого уведомления свой уникальный tag — раньше был один общий tag "xcar-sync",
  // из-за чего на телефоне новое уведомление заменяло предыдущее в шторке, и было видно
  // только самое последнее. С уникальным tag каждое действие показывается отдельной
  // строкой, как обычные уведомления любого приложения.
  const uniqueTag = "xcar-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7);
  event.waitUntil(
    (async () => {
      await self.registration.showNotification(data.title || "XCAR", {
        body: data.body || "",
        icon: "./icons/icon-192.png",
        badge: "./icons/icon-192.png",
        tag: uniqueTag,
        renotify: true,
        silent: false,
        vibrate: [220, 90, 220, 90, 220],
        data: { url: "./index.html" },
      });
      // если приложение сейчас открыто на экране — многие браузеры не показывают системное
      // уведомление поверх активной вкладки, поэтому дублируем сигнал в саму страницу:
      // она проиграет свой звук и вибрацию и добавит запись в колокольчик уведомлений
      const clientsList = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      clientsList.forEach((c) => c.postMessage({ type: "xcar-push", title: data.title || "XCAR", body: data.body || "" }));
    })()
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || "./index.html";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    })
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.url.includes("cdn.jsdelivr.net")) {
    event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
    return;
  }
  // навигация (сама страница index.html) и её HTML-документ — всегда "сеть сначала":
  // так свежая версия приложения приходит сразу при каждом открытии (если есть интернет),
  // а старая версия из кэша используется только как запасной вариант офлайн.
  // Раньше здесь было "кэш сначала" — из-за этого уже исправленные баги могли ещё долго
  // казаться "неисправленными", потому что телефон продолжал открывать старую закэшированную
  // версию страницы, пока пользователь не нажимал кнопку обновления вручную.
  const isNavigation =
    event.request.mode === "navigate" ||
    event.request.destination === "document" ||
    event.request.url.endsWith("/index.html");
  if (isNavigation) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }
  event.respondWith(
    caches.match(event.request).then((cached) => {
      return (
        cached ||
        fetch(event.request)
          .then((response) => {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
            return response;
          })
          .catch(() => cached)
      );
    })
  );
});
