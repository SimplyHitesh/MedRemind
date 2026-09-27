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
import { Separator } from '@/components/ui/separator'
import { toast } from 'sonner'

const TIMEZONES = [
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
  const [loading, setLoading] = useState(true)

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

      const applicationServerKey = urlBase64ToUint8Array(vapidPublicKey)
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: applicationServerKey.buffer.slice(
          applicationServerKey.byteOffset,
          applicationServerKey.byteOffset + applicationServerKey.byteLength
        ) as ArrayBuffer,
      })

      // Save to Supabase via Edge Function
      const supabase = createClient()
      const { error } = await supabase.functions.invoke('save-push-subscription', {
        body: {
          subscription: {
            endpoint: subscription.endpoint,
            keys: {
              p256dh: btoa(String.fromCharCode(...new Uint8Array(subscription.getKey('p256dh')!))),
              auth: btoa(String.fromCharCode(...new Uint8Array(subscription.getKey('auth')!))),
            },
          },
        },
      })

      if (error) {
        toast.error('Failed to save push subscription')
      } else {
        setPushEnabled(true)
        toast.success('Push notifications enabled! 🔔')
      }
    } catch (err) {
      console.error('Push subscription error:', err)
      toast.error('Failed to enable push notifications.')
    }

    setEnablingPush(false)
  }

  async function disablePushNotifications() {
    setEnablingPush(true)
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    // Unsubscribe from browser push
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration('/sw.js')
      if (reg) {
        const sub = await reg.pushManager.getSubscription()
        if (sub) await sub.unsubscribe()
      }
    }

    // Clear from profile
    await supabase
      .from('profiles')
      .update({ push_subscription: null })
      .eq('id', user.id)

    setPushEnabled(false)
    toast.success('Push notifications disabled.')
    setEnablingPush(false)
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
              <Label>Timezone</Label>
              <Select value={timezone} onValueChange={(v) => v && setTimezone(v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIMEZONES.map((tz) => (
                    <SelectItem key={tz} value={tz}>{tz}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={disablePushNotifications}
                      disabled={enablingPush}
                      className="text-red-600 hover:bg-red-50"
                    >
                      {enablingPush ? '…' : 'Disable'}
                    </Button>
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

                <div className="bg-blue-50 border border-blue-200 rounded-md p-3">
                  <p className="text-xs text-blue-800">
                    When enabled, you&apos;ll receive a browser notification each time a medication dose is due.
                    Notifications work even when the app tab is not active.
                  </p>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
