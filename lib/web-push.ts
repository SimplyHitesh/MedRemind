import webpush from 'web-push'

const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || ''
const privateKey = process.env.VAPID_PRIVATE_KEY || ''
const subject = process.env.VAPID_SUBJECT || 'mailto:support@medremind.app'

if (publicKey && privateKey) {
  webpush.setVapidDetails(subject, publicKey, privateKey)
}

export interface PushSubscriptionData {
  endpoint: string
  keys: {
    p256dh: string
    auth: string
  }
}

export async function sendWebPushNotification(
  subscription: PushSubscriptionData,
  payload: {
    title: string
    body: string
    data?: Record<string, unknown>
  }
) {
  if (!publicKey || !privateKey) {
    throw new Error('VAPID keys not configured')
  }

  const payloadString = JSON.stringify({
    title: payload.title,
    body: payload.body,
    data: payload.data || {},
  })

  return await webpush.sendNotification(
    {
      endpoint: subscription.endpoint,
      keys: {
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
      },
    },
    payloadString,
    {
      TTL: 60,
    }
  )
}
