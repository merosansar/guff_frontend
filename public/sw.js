/* Guff service worker: makes the app installable, keeps a copy of the app shell for
   offline starts, and shows push notifications while no Guff tab is open. */

const SHELL = "guff-shell-v1"

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((cache) => cache.addAll(["/", "/favicon.svg", "/manifest.webmanifest"]))
      .catch(() => {}),
  )
  self.skipWaiting()
})

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((n) => n !== SHELL).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener("fetch", (event) => {
  const request = event.request
  if (request.method !== "GET") return
  const url = new URL(request.url)
  // Never cache the API, the live connection or files: they're private and always fresh.
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api") || url.pathname.startsWith("/socket.io")) return

  // Pages: network first, so a new version shows straight away; the cached shell when offline.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone()
          caches.open(SHELL).then((c) => c.put("/", copy)).catch(() => {})
          return res
        })
        .catch(() => caches.match("/").then((cached) => cached || Response.error())),
    )
    return
  }

  // Built assets have a hash in their name, so a cached copy is always right.
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((res) => {
            if (res.ok) {
              const copy = res.clone()
              caches.open(SHELL).then((c) => c.put(request, copy)).catch(() => {})
            }
            return res
          }),
      ),
    )
  }
})

self.addEventListener("push", (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = { title: "Guff", body: event.data ? event.data.text() : "" }
  }
  const title = data.title || "Guff"
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      // A visible Guff tab already shows its own notification.
      if (clients.some((c) => c.visibilityState === "visible")) return
      return self.registration.showNotification(title, {
        body: data.body || "",
        icon: "/icon-192.png",
        badge: "/icon-192.png",
        tag: data.tag,
        renotify: !!data.tag,
        data: { url: data.url || "/" },
      })
    }),
  )
})

self.addEventListener("notificationclick", (event) => {
  event.notification.close()
  const target = new URL((event.notification.data && event.notification.data.url) || "/", self.location.origin).href
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (new URL(client.url).origin === self.location.origin && "focus" in client) {
          return client.focus().then((c) => (c && "navigate" in c ? c.navigate(target) : undefined))
        }
      }
      return self.clients.openWindow(target)
    }),
  )
})
