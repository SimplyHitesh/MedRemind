// Service Worker for Web Push notifications
// Handles push events, interactive action buttons (Taken, Snooze, Noted), and nagging reminders

self.addEventListener('install', () => {
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

  const title = data.title ?? '💊 Time for your Medication'
  const options = {
    body: data.body ?? 'Time to take your scheduled dose.',
    icon: '/favicon.ico',
    badge: '/favicon.ico',
    data: data.data ?? {},
    actions: [
      { action: 'taken', title: '✅ Tablet Taken' },
      { action: 'snooze', title: '⏰ Snooze 10m' },
      { action: 'noted', title: 'Noted' },
    ],
    requireInteraction: true,
    tag: data.data?.medication_log_id ?? 'med-reminder',
  }

  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const logId = event.notification.data?.medication_log_id

  if (event.action === 'taken') {
    // 1. Mark as taken directly via API
    event.waitUntil(
      (async () => {
        if (logId) {
          try {
            await fetch('/api/logs/take', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ logId }),
            })
          } catch (e) {
            console.error('Failed to mark as taken in SW background:', e)
          }
        }
        // Focus or open dashboard
        const clientList = await clients.matchAll({ type: 'window', includeUncontrolled: true })
        for (const client of clientList) {
          if (client.url.includes('/dashboard') && 'focus' in client) {
            return client.focus()
          }
        }
        if (clients.openWindow) return clients.openWindow('/dashboard')
      })()
    )
  } else if (event.action === 'snooze') {
    // 2. Snooze for 10 minutes
    event.waitUntil(
      (async () => {
        if (logId) {
          try {
            await fetch('/api/logs/snooze', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ logId, minutes: 10 }),
            })
          } catch (e) {
            console.error('Failed to snooze in SW background:', e)
          }
        }
      })()
    )
  } else if (event.action === 'noted') {
    // User noted, do not open window
    return
  } else {
    // Clicked notification body -> focus/open dashboard
    event.waitUntil(
      clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
        for (const client of clientList) {
          if (client.url.includes('/dashboard') && 'focus' in client) {
            return client.focus()
          }
        }
        if (clients.openWindow) return clients.openWindow('/dashboard')
      })
    )
  }
})
