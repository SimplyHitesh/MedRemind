import { createClient } from 'jsr:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Verify shared secret
    const cronSecret = req.headers.get('x-cron-secret')
    const expectedSecret = Deno.env.get('CRON_SECRET')
    if (!expectedSecret || cronSecret !== expectedSecret) {
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
      return new Response(JSON.stringify({ error: 'Failed to fetch schedules' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
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
      // Skip if past medication duration_end_date
      if (med.duration_end_date && med.duration_end_date < todayStr) continue
      // Skip if past schedule end_date
      if (schedule.end_date && schedule.end_date < todayStr) continue

      const profile = schedule.profiles as { timezone: string }
      const tz = profile?.timezone ?? 'UTC'

      // Parse time_of_day: "HH:MM:SS"
      const [hours, minutes] = (schedule.time_of_day as string).split(':').map(Number)

      // Check if scheduled time matches current minute in user's timezone
      const tzNow = new Date(now.toLocaleString('en-US', { timeZone: tz }))
      if (tzNow.getHours() !== hours || tzNow.getMinutes() !== minutes) {
        continue
      }

      // Convert local scheduled instant to UTC instant
      const localOffset = new Date(now.toLocaleString('en-US', { timeZone: 'UTC' })).getTime()
        - tzNow.getTime()
      const scheduledLocal = new Date(tzNow)
      scheduledLocal.setHours(hours, minutes, 0, 0)
      const scheduledUtc = new Date(scheduledLocal.getTime() + localOffset)

      // Check day of week for specific_days schedules
      if (schedule.recurrence === 'specific_days') {
        const userDow = tzNow.getDay() // 0=Sunday..6=Saturday
        const allowedDays = schedule.days_of_week as number[] ?? []
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
      const { error: insertError } = await supabase
        .from('medication_logs')
        .upsert(logsToInsert, { onConflict: 'schedule_id,scheduled_for', ignoreDuplicates: true })

      if (insertError) {
        console.error('Failed to insert medication logs:', insertError)
      }
    }

    // 10 minutes ago for nagging, 2 hours ago cutoff for missed
    const tenMinutesAgo = new Date(now.getTime() - 10 * 60 * 1000).toISOString()
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString()

    // ================================================================
    // DISPATCH STEP: Send notifications for pending unnotified or nagged logs
    // ================================================================
    const { data: dueLogs, error: dueError } = await supabase
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
      .eq('status', 'pending')
      .lte('scheduled_for', nowIso)
      .gt('scheduled_for', twoHoursAgo)
      .or(`snoozed_until.is.null,snoozed_until.lte.${nowIso}`)
      .or(`notified_at.is.null,notified_at.lte.${tenMinutesAgo}`)

    if (dueError) {
      console.error('Failed to fetch due logs:', dueError)
    }

    const vapidPublicKey = Deno.env.get('VAPID_PUBLIC_KEY') ?? ''
    const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY') ?? ''

    for (const log of dueLogs ?? []) {
      const profile = log.profiles as { push_subscription: Record<string, unknown> | null; timezone: string }
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

      // Calculate supply/refill warning
      let refillWarning = ''
      if (medication.tablets_remaining !== null) {
        const remaining = Number(medication.tablets_remaining)
        const perDose = Number(medication.tablets_per_dose || 1)
        if (remaining <= perDose) {
          refillWarning = ` 🚨 CRITICAL: Only ${remaining} ${medication.dose_unit} left!`
        } else if (remaining <= perDose * (medication.refill_alert_days || 3)) {
          refillWarning = ` ⚠️ Refill alert: ${remaining} ${medication.dose_unit} left.`
        }
      }

      const isNag = !!log.notified_at
      const title = isNag ? `⏰ Reminder: ${medication.name}` : `💊 Time for ${medication.name}`
      const bodyText = isNag
        ? `You haven't marked your ${medication.dose_amount} ${medication.dose_unit} as taken yet.${refillWarning}`
        : `Take ${medication.dose_amount} ${medication.dose_unit} now.${refillWarning}`

      const payload = {
        medication_log_id: log.id,
        medication_name: medication.name,
        dose: `${medication.dose_amount} ${medication.dose_unit}`,
        scheduled_for: log.scheduled_for,
        refill_warning: refillWarning.trim() || null,
        is_nag: isNag,
      }

      let notificationStatus: 'sent' | 'failed' | 'mocked' = 'mocked'
      let channel: 'push' | 'email' = 'email'

      if (profile.push_subscription && vapidPublicKey && vapidPrivateKey) {
        channel = 'push'
        try {
          const pushSubscription = profile.push_subscription as {
            endpoint: string
            keys: { p256dh: string; auth: string }
          }

          const pushPayload = JSON.stringify({
            title,
            body: bodyText,
            data: payload,
          })

          webpush.setVapidDetails(
            'mailto:support@medremind.app',
            vapidPublicKey,
            vapidPrivateKey
          )

          await webpush.sendNotification(pushSubscription, pushPayload, {
            TTL: 60,
          })

          notificationStatus = 'sent'
        } catch (err) {
          console.error('Web push failed:', err)
          notificationStatus = 'failed'
        }
      }
      // If no push subscription, fall through with mocked email

      // Insert notification log
      await supabase.from('notification_logs').insert({
        user_id: log.user_id,
        medication_log_id: log.id,
        channel,
        payload,
        status: notificationStatus,
      })

      // Mark log as notified
      await supabase
        .from('medication_logs')
        .update({ notified_at: nowIso })
        .eq('id', log.id)
    }

    // ================================================================
    // MISSED-DOSE STEP: Mark overdue pending logs as missed
    // ================================================================
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString()
    await supabase
      .from('medication_logs')
      .update({ status: 'missed' })
      .eq('status', 'pending')
      .lt('scheduled_for', twoHoursAgo)

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
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
