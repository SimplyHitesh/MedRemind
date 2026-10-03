import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendWebPushNotification } from '@/lib/web-push'
import { NextResponse } from 'next/server'

export async function POST() {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const admin = createAdminClient()
    const { data: profile, error } = await admin
      .from('profiles')
      .select('push_subscription')
      .eq('id', user.id)
      .single()

    if (error || !profile?.push_subscription) {
      return NextResponse.json(
        { error: 'No active notification subscription found. Please tap "Enable Notifications" first.' },
        { status: 400 }
      )
    }

    const title = '🧪 Test Notification'
    const body = 'This is a test notification from MedRemind. Your reminder alerts are working properly!'

    try {
      await sendWebPushNotification(profile.push_subscription, {
        title,
        body,
        data: {
          test: true,
          timestamp: new Date().toISOString(),
        },
      })
    } catch (pushErr: unknown) {
      const errObj = pushErr as { statusCode?: number; message?: string }
      const isGone =
        errObj?.statusCode === 410 ||
        errObj?.statusCode === 404 ||
        String(errObj?.message || '').includes('unexpected response code')

      if (isGone) {
        // Clear stale subscription from DB so user can cleanly re-subscribe
        await admin
          .from('profiles')
          .update({ push_subscription: null, updated_at: new Date().toISOString() })
          .eq('id', user.id)

        return NextResponse.json(
          {
            error:
              'Notification session was unsubscribed. Please tap "Enable Notifications" to generate a fresh subscription.',
          },
          { status: 410 }
        )
      }
      throw pushErr
    }

    return NextResponse.json({ success: true, message: 'Notification sent successfully!' })
  } catch (err) {
    console.error('Failed to send test push notification:', err)
    return NextResponse.json(
      { error: (err as Error).message || 'Failed to send notification' },
      { status: 500 }
    )
  }
}
