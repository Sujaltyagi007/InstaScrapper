/* IG Monitor service worker: push notifications, notification clicks, offline fallback.
 *
 * Deliberately does NOT cache app pages or API responses: every navigation goes to
 * the network so auth and live data behave exactly as without a service worker.
 * The only cached file is the offline page, shown when the network is unreachable.
 */
const VERSION = "v1";
const OFFLINE_CACHE = `igm-offline-${VERSION}`;
const OFFLINE_URL = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(OFFLINE_CACHE)
      .then((cache) => cache.addAll([OFFLINE_URL, "/icons/icon-192.png"]))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith("igm-offline-") && k !== OFFLINE_CACHE).map((k) => caches.delete(k)));
      if (self.registration.navigationPreload) await self.registration.navigationPreload.enable();
      await self.clients.claim();
    })(),
  );
});

// Page navigations only: network (with navigation preload), offline page if that fails.
self.addEventListener("fetch", (event) => {
  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin === self.location.origin && requestUrl.pathname === "/icons/icon-192.png") {
    event.respondWith(
      caches.open(OFFLINE_CACHE).then((cache) => cache.match(requestUrl.pathname).then((cached) => cached || fetch(event.request))),
    );
    return;
  }

  if (event.request.mode !== "navigate") return;
  event.respondWith(
    (async () => {
      try {
        const preloaded = await event.preloadResponse;
        if (preloaded) return preloaded;
        return await fetch(event.request);
      } catch {
        const cache = await caches.open(OFFLINE_CACHE);
        return (await cache.match(OFFLINE_URL)) || Response.error();
      }
    })(),
  );
});

// ---- Push ---------------------------------------------------------------

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  const options = {
    body: data.body || "",
    icon: "/icons/icon-192.png",
    badge: "/icons/badge-96.png",
    data: { url: data.url || "/" },
    timestamp: Date.now(),
  };
  // Same tag = replaces the earlier notification (e.g. repeated changes on one account) instead of stacking.
  if (data.tag) {
    options.tag = data.tag;
    options.renotify = true;
  }
  event.waitUntil(self.registration.showNotification(data.title || "IG Monitor", options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const requested = new URL((event.notification.data && event.notification.data.url) || "/", self.location.origin);
  // Only ever open pages of this app.
  const url = requested.origin === self.location.origin ? requested.href : `${self.location.origin}/`;

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const existing = windows.find((c) => new URL(c.url).origin === self.location.origin);
      if (existing) {
        await existing.focus();
        // The app is one page at "/": it opens the screen in place (no reload, open
        // tabs keep their state). Anywhere else (e.g. the login page) navigate there;
        // old-style paths are handed to "/" by the server.
        if (new URL(existing.url).pathname === "/") {
          existing.postMessage({ type: "navigate", url });
          return;
        }
        try {
          await existing.navigate(url);
        } catch {
          existing.postMessage({ type: "navigate", url });
        }
        return;
      }
      await self.clients.openWindow(url);
    })(),
  );
});

// The browser rotated the subscription: subscribe again and tell the server.
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      const oldEndpoint = event.oldSubscription ? event.oldSubscription.endpoint : undefined;
      let sub = event.newSubscription;
      if (!sub) {
        const res = await fetch("/api/push/subscriptions", { credentials: "same-origin" });
        if (!res.ok) return;
        const { publicKey } = await res.json();
        if (!publicKey) return;
        sub = await self.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: base64UrlToUint8Array(publicKey),
        });
      }
      await fetch("/api/push/subscriptions", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscription: sub.toJSON(), oldEndpoint }),
      });
    })(),
  );
});

function base64UrlToUint8Array(value) {
  const padded = (value + "=".repeat((4 - (value.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}
