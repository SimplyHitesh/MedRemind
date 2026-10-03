import { createClient } from '@/lib/supabase/server'
import { NextResponse, type NextRequest } from 'next/server'

export async function POST(request: NextRequest) {
  try {
    const { logId, minutes = 10 } = await request.json()
    if (!logId) {
      return NextResponse.json({ error: 'logId is required' }, { status: 400 })
    }

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const targetMs = Date.now() + Number(minutes) * 60 * 1000
    // Align to the minute boundary so cron (:00) picks it up promptly at the target minute
    const snoozedUntil = new Date(Math.floor(targetMs / 60000) * 60000).toISOString()
    const { data, error } = await supabase
      .from('medication_logs')
      .update({
        snoozed_until: snoozedUntil,
        status: 'pending',
      })
      .eq('id', logId)
      .eq('user_id', user.id)
      .select()
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, log: data, snoozed_until: snoozedUntil })
  } catch (err) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
