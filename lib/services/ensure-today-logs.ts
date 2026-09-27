import { createAdminClient } from '@/lib/supabase/admin'

export function getUtcInstant(dateStr: string, timeStr: string, timeZone: string): Date {
  const cleanTime = timeStr.length === 5 ? `${timeStr}:00` : timeStr
  const candidate = new Date(`${dateStr}T${cleanTime}Z`)
  const tzDateStr = candidate.toLocaleString('en-US', { timeZone, hour12: false })
  const utcDateStr = candidate.toLocaleString('en-US', { timeZone: 'UTC', hour12: false })
  const diffMs = new Date(tzDateStr).getTime() - new Date(utcDateStr).getTime()
  return new Date(candidate.getTime() - diffMs)
}

export async function ensureTodayLogs(userId: string) {
  try {
    const admin = createAdminClient()

    // 1. Fetch user's profile for timezone
    const { data: profile } = await admin
      .from('profiles')
      .select('timezone')
      .eq('id', userId)
      .single()

    const tz = profile?.timezone || 'UTC'
    const now = new Date()

    // Format today in user's timezone as YYYY-MM-DD
    const tzFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: tz })
    const todayStr = tzFormatter.format(now)

    // Day of week in user's timezone
    const dowFormatter = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' })
    const dowMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
    const todayDow = dowMap[dowFormatter.format(now)] ?? now.getDay()

    // 2. Fetch active schedules for active medications
    const { data: schedules, error } = await admin
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
        medications!inner(is_active, duration_end_date)
      `)
      .eq('user_id', userId)
      .eq('is_active', true)

    if (error || !schedules || schedules.length === 0) return

    const logsToInsert: Array<{
      schedule_id: string
      medication_id: string
      user_id: string
      scheduled_for: string
      status: 'pending'
    }> = []

    for (const s of schedules) {
      const med = s.medications as unknown as { is_active: boolean; duration_end_date: string | null }
      if (!med || !med.is_active) continue
      if (med.duration_end_date && med.duration_end_date < todayStr) continue
      if (s.start_date && s.start_date > todayStr) continue
      if (s.end_date && s.end_date < todayStr) continue

      if (s.recurrence === 'specific_days') {
        const allowedDays = (s.days_of_week as number[]) || []
        if (!allowedDays.includes(todayDow)) continue
      }

      const scheduledUtc = getUtcInstant(todayStr, s.time_of_day, tz)

      logsToInsert.push({
        schedule_id: s.id,
        medication_id: s.medication_id,
        user_id: s.user_id,
        scheduled_for: scheduledUtc.toISOString(),
        status: 'pending',
      })
    }

    if (logsToInsert.length > 0) {
      await admin
        .from('medication_logs')
        .upsert(logsToInsert, { onConflict: 'schedule_id,scheduled_for', ignoreDuplicates: true })
    }
  } catch (err) {
    console.error('ensureTodayLogs error:', err)
  }
}
