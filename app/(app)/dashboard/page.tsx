import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import DashboardClient from './dashboard-client'
import { ensureTodayLogs, getUtcInstant } from '@/lib/services/ensure-today-logs'

export default async function DashboardPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  // Automatically generate today's doses for user's active schedules
  await ensureTodayLogs(user.id)

  // Fetch user profile timezone
  const { data: profile } = await supabase
    .from('profiles')
    .select('timezone')
    .eq('id', user.id)
    .single()

  const tz = profile?.timezone || 'UTC'
  const tzFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: tz })
  const todayStr = tzFormatter.format(new Date())

  // Compute timezone-exact start and end of "today"
  const startUtc = getUtcInstant(todayStr, '00:00:00', tz)
  const endUtc = getUtcInstant(todayStr, '23:59:59', tz)

  const { data: logs } = await supabase
    .from('medication_logs')
    .select(`
      *,
      medications (
        id,
        name,
        dose_amount,
        dose_unit,
        form,
        color_tag,
        tablets_remaining,
        tablets_per_dose,
        refill_alert_days,
        duration_end_date
      )
    `)
    .eq('user_id', user.id)
    .gte('scheduled_for', startUtc.toISOString())
    .lte('scheduled_for', endUtc.toISOString())
    .order('scheduled_for', { ascending: true })

  const { data: medications } = await supabase
    .from('medications')
    .select('*, schedules(*)')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .order('name')

  return (
    <DashboardClient
      initialLogs={logs ?? []}
      initialMedications={medications ?? []}
      userId={user.id}
    />
  )
}
