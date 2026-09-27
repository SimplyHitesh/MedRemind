import { createClient } from '@/lib/supabase/server'
import { ensureTodayLogs } from '@/lib/services/ensure-today-logs'
import { NextResponse } from 'next/server'

export async function POST() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    await ensureTodayLogs(user.id)
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('ensure-today API error:', err)
    return NextResponse.json({ error: 'Failed to ensure logs' }, { status: 500 })
  }
}
