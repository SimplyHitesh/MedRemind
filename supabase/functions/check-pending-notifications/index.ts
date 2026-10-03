import { createClient } from 'jsr:@supabase/supabase-js@2'
import webpush from 'npm:web-push'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Check cron secret if provided
    const cronSecret = req.headers.get('x-cron-secret')
    const expectedSecret = Deno.env.get('CRON_SECRET')
    if (expectedSecret && cronSecret && cronSecret !== expectedSecret) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const now = new Date()
    const nowIso = now.toISOString()

    // ================================================================
    // GENERATION STEP: Find due schedules and insert medication_logs
    // ================================================================
    const { data: activeSchedules, error: schedError } = await supabase
      .from('schedules')
      .select(`
        id,
        medication_id,
        user_id,
        time_of_day,
        recurrence,
        days_of_week,
        start_date,
        end_date,
        profiles!inner(timezone),
        medications!inner(is_active, duration_end_date)
      `)
      .eq('is_active', true)
      .lte('start_date', now.toISOString().split('T')[0])

    if (schedError) {
      console.error('Failed to fetch schedules:', schedError)
    }

    const logsToInsert: {
      schedule_id: string
      medication_id: string
      user_id: string
      scheduled_for: string
      status: string
    }[] = []

    const todayStr = now.toISOString().split('T')[0]

    for (const schedule of activeSchedules ?? []) {
      const med = schedule.medications as { is_active: boolean; duration_end_date: string | null }
      if (!med || !med.is_active) continue
      if (med.duration_end_date && med.duration_end_date < todayStr) continue
      if (schedule.end_date && schedule.end_date < todayStr) continue

      const profile = schedule.profiles as { timezone: string }
      const tz = profile?.timezone ?? 'UTC'

      const [hours, minutes] = (schedule.time_of_day as string).split(':').map(Number)
      const tzNow = new Date(now.toLocaleString('en-US', { timeZone: tz }))
      if (tzNow.getHours() !== hours || tzNow.getMinutes() !== minutes) {
        continue
      }

      const localOffset =
        new Date(now.toLocaleString('en-US', { timeZone: 'UTC' })).getTime() - tzNow.getTime()
      const scheduledLocal = new Date(tzNow)
      scheduledLocal.setHours(hours, minutes, 0, 0)
      const scheduledUtc = new Date(scheduledLocal.getTime() + localOffset)

      if (schedule.recurrence === 'specific_days') {
        const userDow = tzNow.getDay()
        const allowedDays = (schedule.days_of_week as number[]) ?? []
        if (!allowedDays.includes(userDow)) continue
      }

      logsToInsert.push({
        schedule_id: schedule.id,
        medication_id: schedule.medication_id,
        user_id: schedule.user_id,
        scheduled_for: scheduledUtc.toISOString(),
        status: 'pending',
      })
    }

    if (logsToInsert.length > 0) {
      await supabase
        .from('medication_logs')
        .upsert(logsToInsert, { onConflict: 'schedule_id,scheduled_for', ignoreDuplicates: true })
    }

    // 10 minutes ago for nagging, 2 hours ago cutoff for missed
    // ================================================================
    // DISPATCH STEP: Send notifications for pending unnotified or snoozed logs
    // ================================================================
    const { data: pendingLogs, error: dueError } = await supabase
      .from('medication_logs')
      .select(`
        id,
        user_id,
        medication_id,
        scheduled_for,
        notified_at,
        snoozed_until,
        medications!inner(name, dose_amount, dose_unit, is_active, tablets_remaining, tablets_per_dose, refill_alert_days),
        profiles!inner(push_subscription, timezone)
      `)
      .in('status', ['pending', 'missed'])
      .lte('scheduled_for', nowIso)

    if (dueError) {
      console.error('Failed to fetch due logs:', dueError)
    }

    const nowTime = now.getTime()
    const tenMins = 10 * 60 * 1000

    const dueLogs = (pendingLogs ?? []).filter((log) => {
      const notifiedTime = log.notified_at ? new Date(log.notified_at).getTime() : null
      const snoozedTime = log.snoozed_until ? new Date(log.snoozed_until).getTime() : null
      const scheduledTime = new Date(log.scheduled_for).getTime()

      // If snoozed into the future, do NOT notify yet
      if (snoozedTime && snoozedTime > nowTime) {
        return false
      }

      // Case 1: Snooze time has arrived and hasn't been notified since snoozed
      if (snoozedTime && snoozedTime <= nowTime) {
        if (!notifiedTime || notifiedTime < snoozedTime) {
          return true
        }
      }

      // Case 2: Never notified before
      if (!notifiedTime) {
        return true
      }

      // Case 3: Gentle reminder (notified once at scheduled time, not snoozed, 10-35 mins elapsed)
      const timeSinceScheduled = nowTime - scheduledTime
      if (!snoozedTime && timeSinceScheduled >= tenMins && timeSinceScheduled <= 35 * 60 * 1000) {
        if (notifiedTime < scheduledTime + 5 * 60 * 1000) {
          return true
        }
      }

      return false
    })

    const vapidPublicKey = Deno.env.get('VAPID_PUBLIC_KEY') ?? ''
    const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY') ?? ''

    if (vapidPublicKey && vapidPrivateKey) {
      webpush.setVapidDetails('mailto:support@medremind.app', vapidPublicKey, vapidPrivateKey)
    }

    for (const log of dueLogs ?? []) {
      const profile = log.profiles as {
        push_subscription: { endpoint: string; keys: { p256dh: string; auth: string } } | null
        timezone: string
      }
      const medication = log.medications as {
        name: string
        dose_amount: number
        dose_unit: string
        is_active: boolean
        tablets_remaining: number | null
        tablets_per_dose: number
        refill_alert_days: number
      }

      if (!medication.is_active) continue

      let refillWarning = ''
      if (medication.tablets_remaining !== null) {
        const remaining = Number(medication.tablets_remaining)
        const perDose = Number(medication.tablets_per_dose || 1)
        if (remaining <= perDose) {
          refillWarning = ` · 🚨 Only ${remaining} ${medication.dose_unit} left!`
        } else if (remaining <= perDose * (medication.refill_alert_days || 3)) {
          refillWarning = ` · ⚠️ Low: ${remaining} ${medication.dose_unit} left`
        }
      }

      const isSnooze = !!log.snoozed_until && new Date(log.snoozed_until).getTime() <= nowTime
      const isNag = !isSnooze && !!log.notified_at

      let title = `💊 Time for ${medication.name}`
      let bodyText = `Take ${medication.dose_amount} ${medication.dose_unit} now.${refillWarning}`

      if (isSnooze) {
        title = `⏰ Snooze Reminder: ${medication.name}`
        bodyText = `Snooze finished for ${medication.name} (${medication.dose_amount} ${medication.dose_unit}). Time to take it!${refillWarning}`
      } else if (isNag) {
        title = `⏰ Reminder: ${medication.name}`
        bodyText = `You haven't taken your ${medication.dose_amount} ${medication.dose_unit} yet.${refillWarning}`
      }

      const payload = {
        medication_log_id: log.id,
        medication_name: medication.name,
        dose: `${medication.dose_amount} ${medication.dose_unit}`,
        scheduled_for: log.scheduled_for,
        refill_warning: refillWarning.trim() || null,
        is_nag: isNag,
        is_snooze: isSnooze,
      }

      let notificationStatus: 'sent' | 'failed' | 'mocked' = 'mocked'
      let channel: 'push' | 'email' = 'email'

      if (profile?.push_subscription && vapidPublicKey && vapidPrivateKey) {
        channel = 'push'
        try {
          const pushPayload = JSON.stringify({
            title,
            body: bodyText,
            data: payload,
          })

          await webpush.sendNotification(profile.push_subscription, pushPayload, {
            urgency: 'high',
            TTL: 60,
          })

          notificationStatus = 'sent'
        } catch (err: unknown) {
          console.error('Web push failed for user:', log.user_id, err)
          notificationStatus = 'failed'

          // If expired (410 / 404), clean up dead subscription from DB
          const errStatus = (err as { statusCode?: number })?.statusCode
          if (errStatus === 410 || errStatus === 404) {
            await supabase
              .from('profiles')
              .update({ push_subscription: null })
              .eq('id', log.user_id)
          }
        }
      }

      // Log notification
      await supabase.from('notification_logs').insert({
        user_id: log.user_id,
        medication_log_id: log.id,
        channel,
        payload,
        status: notificationStatus,
      })

      // Mark log as notified, clear snoozed_until, and keep status as 'pending'
      await supabase
        .from('medication_logs')
        .update({ notified_at: nowIso, snoozed_until: null, status: 'pending' })
        .eq('id', log.id)
    }

    return new Response(
      JSON.stringify({
        ok: true,
        generated: logsToInsert.length,
        dispatched: (dueLogs ?? []).length,
        timestamp: nowIso,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    console.error('check-pending-notifications unexpected error:', err)
    return new Response(JSON.stringify({ error: (err as Error).message || 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
