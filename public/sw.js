// Service Worker for Web Push notifications
// Handles push events and shows browser notifications

self.addEventListener('install', (event) => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim())
})

self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data?.json() ?? {}
  } catch {
    data = { title: 'MedRemind', body: event.data?.text() ?? 'Time for your medication' }
  }

  const title = data.title ?? 'MedRemind - Medication Reminder'
  const options = {
    body: data.body ?? 'Time to take your medication',
    icon: '/favicon.ico',
    badge: '/favicon.ico',
    data: data.data ?? {},
    actions: [
      { action: 'taken', title: '✅ Mark as Taken' },
      { action: 'dismiss', title: 'Dismiss' },
    ],
    requireInteraction: true,
    tag: data.data?.medication_log_id ?? 'med-reminder',
  }

  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  if (event.action === 'taken') {
    // Open dashboard
    event.waitUntil(
      clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
        for (const client of clientList) {
          if (client.url.includes('/dashboard') && 'focus' in client) {
            return client.focus()
          }
        }
        if (clients.openWindow) {
          return clients.openWindow('/dashboard')
        }
      })
    )
  } else {
    event.waitUntil(
      clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
        for (const client of clientList) {
          if ('focus' in client) return client.focus()
        }
        if (clients.openWindow) return clients.openWindow('/dashboard')
      })
    )
  }
})
