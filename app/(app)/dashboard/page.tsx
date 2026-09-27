import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import DashboardClient from './dashboard-client'

export default async function DashboardPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  // Fetch today's medication logs joined with medications
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  const todayEnd = new Date()
  todayEnd.setHours(23, 59, 59, 999)

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
        color_tag
      )
    `)
    .eq('user_id', user.id)
    .gte('scheduled_for', todayStart.toISOString())
    .lte('scheduled_for', todayEnd.toISOString())
    .order('scheduled_for', { ascending: true })

  return <DashboardClient initialLogs={logs ?? []} userId={user.id} />
}
