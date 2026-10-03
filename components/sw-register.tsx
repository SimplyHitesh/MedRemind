'use client'

import { useEffect } from 'react'

export function ServiceWorkerRegister() {
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker
        .register('/sw.js')
        .then((reg) => {
          // Check for sw.js updates automatically on page visit
          reg.update().catch(() => {})
        })
        .catch((err) => {
          console.error('Service worker registration failed:', err)
        })
    }
  }, [])

  return null
}
