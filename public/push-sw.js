// Daily reminders, imported into the generated service worker (vite.config.ts, workbox.importScripts).
// Pushes from reminders/ carry no payload; one that does may set its own title and body.
self.addEventListener('push', (event) => {
  let title = 'Your Atlas cards are ready'
  let body = 'A few minutes keeps your streak going.'
  try {
    const data = event.data && event.data.json()
    if (data && typeof data.title === 'string') title = data.title
    if (data && typeof data.body === 'string') body = data.body
  } catch {
    /* no payload, or not JSON */
  }
  event.waitUntil(self.registration.showNotification(title, { body, icon: '/pwa-192.png', tag: 'atlas-reminder' }))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const open = windows.find((w) => new URL(w.url).origin === self.location.origin)
      return open ? open.focus() : self.clients.openWindow('/')
    }),
  )
})
