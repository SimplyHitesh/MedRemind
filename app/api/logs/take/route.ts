import { createClient } from '@/lib/supabase/server'
import { NextResponse, type NextRequest } from 'next/server'

export async function POST(request: NextRequest) {
  try {
    const { logId } = await request.json()
    if (!logId) {
      return NextResponse.json({ error: 'logId is required' }, { status: 400 })
    }

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const now = new Date().toISOString()
    const { data, error } = await supabase
      .from('medication_logs')
      .update({
        status: 'taken',
        taken_at: now,
      })
      .eq('id', logId)
      .eq('user_id', user.id)
      .select(`
        *,
        medications (
          id,
          name,
          tablets_remaining,
          tablets_per_dose
        )
      `)
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, log: data })
  } catch (err) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
