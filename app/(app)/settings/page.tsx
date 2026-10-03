'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { toast } from 'sonner'

function getAllTimezones(): string[] {
  try {
    if (typeof Intl !== 'undefined' && 'supportedValuesOf' in Intl) {
      return Intl.supportedValuesOf('timeZone')
    }
  } catch {
    // fallback
  }
  return [
    'UTC',
    'America/New_York',
    'America/Chicago',
    'America/Denver',
    'America/Los_Angeles',
    'America/Anchorage',
    'America/Honolulu',
    'Europe/London',
    'Europe/Paris',
    'Europe/Berlin',
    'Europe/Moscow',
    'Asia/Kolkata',
    'Asia/Dubai',
    'Asia/Singapore',
    'Asia/Tokyo',
    'Asia/Shanghai',
    'Australia/Sydney',
    'Pacific/Auckland',
  ]
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = window.atob(base64)
  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i)
  }
  return outputArray
}

export default function SettingsPage() {
  const [timezone, setTimezone] = useState('UTC')
  const [pushEnabled, setPushEnabled] = useState(false)
  const [permissionState, setPermissionState] = useState<NotificationPermission>('default')
  const [savingTimezone, setSavingTimezone] = useState(false)
  const [enablingPush, setEnablingPush] = useState(false)
  const [testingPush, setTestingPush] = useState(false)
  const [loading, setLoading] = useState(true)
  const [tzSearch, setTzSearch] = useState('')
  const allTimezones = getAllTimezones()
  const filteredTimezones = allTimezones.filter((tz) =>
    tz.toLowerCase().includes(tzSearch.toLowerCase())
  )

  function detectTimezone() {
    try {
      const detected = Intl.DateTimeFormat().resolvedOptions().timeZone
      if (detected) {
        setTimezone(detected)
        toast.success(`Detected timezone: ${detected}`)
      }
    } catch {
      toast.error('Could not detect timezone automatically')
    }
  }

  // Load profile
  useEffect(() => {
    async function loadProfile() {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { data: profile } = await supabase
        .from('profiles')
        .select('timezone, push_subscription')
        .eq('id', user.id)
        .single()

      if (profile) {
        setTimezone(profile.timezone ?? 'UTC')
        setPushEnabled(!!profile.push_subscription)
      }
      setLoading(false)
    }

    loadProfile()

    // Check notification permission state
    if ('Notification' in window) {
      setPermissionState(Notification.permission)
    }
  }, [])

  async function saveTimezone() {
    setSavingTimezone(true)
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const { error } = await supabase
      .from('profiles')
      .update({ timezone })
      .eq('id', user.id)

    if (error) {
      toast.error('Failed to save timezone')
    } else {
      toast.success('Timezone saved!')
    }
    setSavingTimezone(false)
  }

  async function enablePushNotifications() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      toast.error('Push notifications are not supported in this browser.')
      return
    }

    setEnablingPush(true)

    try {
      // Register Service Worker
      const registration = await navigator.serviceWorker.register('/sw.js')
      await navigator.serviceWorker.ready

      // Request permission
      const permission = await Notification.requestPermission()
      setPermissionState(permission)

      if (permission !== 'granted') {
        toast.error('Notification permission denied. Please enable notifications in your browser settings.')
        setEnablingPush(false)
        return
      }

      // Subscribe to push
      const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
      if (!vapidPublicKey) {
        toast.error('VAPID key not configured. Push notifications require deployment configuration.')
        setEnablingPush(false)
        return
      }

      // Unsubscribe any stale existing subscription on device before requesting a fresh one
      const existingSub = await registration.pushManager.getSubscription()
      if (existingSub) {
        try {
          await existingSub.unsubscribe()
        } catch {}
      }

      const applicationServerKey = urlBase64ToUint8Array(vapidPublicKey)
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: applicationServerKey.buffer.slice(
          applicationServerKey.byteOffset,
          applicationServerKey.byteOffset + applicationServerKey.byteLength
        ) as ArrayBuffer,
      })

      // Use browser's standard W3C subscription JSON with URL-safe base64 keys
      const subJson = subscription.toJSON()

      // Save reliably via Next.js API route with session cookie
      const res = await fetch('/api/notifications/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription: subJson }),
      })

      const data = await res.json()

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to save push subscription')
      }

      setPushEnabled(true)
      toast.success('Push notifications enabled! 🔔')
    } catch (err) {
      console.error('Push subscription error:', err)
      toast.error((err as Error).message || 'Failed to enable push notifications.')
    }

    setEnablingPush(false)
  }

  async function disablePushNotifications() {
    setEnablingPush(true)

    // Unsubscribe from browser push
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration('/sw.js')
      if (reg) {
        const sub = await reg.pushManager.getSubscription()
        if (sub) await sub.unsubscribe()
      }
    }

    // Clear from profile via API route
    try {
      await fetch('/api/notifications/unsubscribe', { method: 'POST' })
    } catch {}

    setPushEnabled(false)
    toast.success('Push notifications turned off.')
    setEnablingPush(false)
  }

  async function sendTestNotification() {
    setTestingPush(true)
    try {
      const res = await fetch('/api/notifications/test', { method: 'POST' })
      const data = await res.json()
      if (res.ok && data.success) {
        toast.success('Test notification sent! Check your notification bar or lock screen.', {
          duration: 5000,
        })
      } else {
        if (res.status === 410) {
          setPushEnabled(false)
        }
        toast.error(data.error || 'Failed to send test notification')
      }
    } catch {
      toast.error('Failed to send test notification')
    } finally {
      setTestingPush(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="w-8 h-8 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
      </div>
    )
  }

  const pushSupported = typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window

  return (
    <div className="max-w-xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="text-gray-500 text-sm mt-1">Manage your preferences</p>
      </div>

      <div className="space-y-6">
        {/* Timezone */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">🌍 Timezone</CardTitle>
            <CardDescription>
              Your medication reminders will be scheduled in this timezone.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Timezone</Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={detectTimezone}
                  className="text-xs text-blue-600 h-6 px-2"
                >
                  📍 Detect My Timezone
                </Button>
              </div>

              <div className="space-y-2">
                <Input
                  placeholder="Filter timezones (e.g. Kolkata, London, New_York)..."
                  value={tzSearch}
                  onChange={(e) => setTzSearch(e.target.value)}
                  className="text-xs h-8"
                />
                <Select value={timezone} onValueChange={(v) => v && setTimezone(v)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select timezone" />
                  </SelectTrigger>
                  <SelectContent className="max-h-64">
                    {filteredTimezones.length === 0 ? (
                      <div className="py-2 px-3 text-xs text-gray-500">No timezones matching &quot;{tzSearch}&quot;</div>
                    ) : (
                      filteredTimezones.slice(0, 100).map((tz) => (
                        <SelectItem key={tz} value={tz}>{tz}</SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
                {filteredTimezones.length > 100 && (
                  <p className="text-[11px] text-gray-400">Showing first 100 matches. Type above to refine.</p>
                )}
              </div>
            </div>
            <Button onClick={saveTimezone} disabled={savingTimezone} size="sm">
              {savingTimezone ? 'Saving…' : 'Save Timezone'}
            </Button>
          </CardContent>
        </Card>

        <Separator />

        {/* Push Notifications */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">🔔 Push Notifications</CardTitle>
            <CardDescription>
              Receive browser notifications when it&apos;s time to take your medication.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!pushSupported ? (
              <div className="bg-yellow-50 border border-yellow-200 rounded-md p-3">
                <p className="text-sm text-yellow-800">
                  Push notifications are not supported in this browser. Try Chrome, Firefox, or Edge on desktop.
                </p>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-900">
                      Status:{' '}
                      <span className={pushEnabled ? 'text-green-600' : 'text-gray-500'}>
                        {pushEnabled ? '✅ Enabled' : '❌ Disabled'}
                      </span>
                    </p>
                    {permissionState === 'denied' && (
                      <p className="text-xs text-red-600 mt-1">
                        Notifications are blocked. Please enable them in your browser settings.
                      </p>
                    )}
                  </div>

                  {pushEnabled ? (
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={sendTestNotification}
                        disabled={testingPush}
                        className="text-blue-700 border-blue-300 hover:bg-blue-50 text-xs"
                      >
                        {testingPush ? 'Sending…' : '🧪 Send Test Notification'}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={disablePushNotifications}
                        disabled={enablingPush}
                        className="text-red-600 hover:bg-red-50 text-xs"
                      >
                        {enablingPush ? '…' : 'Turn Off'}
                      </Button>
                    </div>
                  ) : (
                    <Button
                      size="sm"
                      onClick={enablePushNotifications}
                      disabled={enablingPush || permissionState === 'denied'}
                    >
                      {enablingPush ? 'Enabling…' : 'Enable Notifications'}
                    </Button>
                  )}
                </div>

                <div className="bg-blue-50 border border-blue-200 rounded-md p-3 space-y-2">
                  <p className="text-xs text-blue-900 font-medium">
                    🔔 When enabled, you&apos;ll receive push notifications whenever a medication dose is due, even if the app tab is closed.
                  </p>
                  <div className="border-t border-blue-200/60 pt-2 text-xs text-blue-800 space-y-1">
                    <p className="font-semibold text-blue-900">📱 Mobile Setup Instructions:</p>
                    <p>
                      • <strong>iPhone (iOS)</strong>: Tap the Safari <strong>Share</strong> button ➔ tap <strong>&quot;Add to Home Screen&quot;</strong>. Open MedRemind from your home screen to enable notifications.
                    </p>
                    <p>
                      • <strong>Android</strong>: Tap the Chrome 3-dots menu ➔ tap <strong>&quot;Install App&quot;</strong> or <strong>&quot;Add to Home Screen&quot;</strong> for full native-app push notifications.
                    </p>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
