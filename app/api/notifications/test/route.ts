import { createClient } from '@/lib/supabase/server'
import { sendWebPushNotification } from '@/lib/web-push'
import { NextResponse } from 'next/server'

export async function POST() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: profile, error } = await supabase
      .from('profiles')
      .select('push_subscription')
      .eq('id', user.id)
      .single()

    if (error || !profile?.push_subscription) {
      return NextResponse.json(
        { error: 'No active push subscription found. Please enable notifications first.' },
        { status: 400 }
      )
    }

    // Send real push notification
    await sendWebPushNotification(profile.push_subscription, {
      title: '💊 Test Medication Reminder',
      body: 'This is a test notification from MedRemind! Tap to test your action buttons.',
      data: {
        test: true,
        timestamp: new Date().toISOString(),
      },
    })

    return NextResponse.json({ success: true, message: 'Notification sent successfully!' })
  } catch (err) {
    console.error('Failed to send test push notification:', err)
    return NextResponse.json(
      { error: (err as Error).message || 'Failed to send notification' },
      { status: 500 }
    )
  }
}
