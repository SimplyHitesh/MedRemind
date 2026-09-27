import { createClient } from '@/lib/supabase/server'
import { NextResponse, type NextRequest } from 'next/server'

export async function POST(request: NextRequest) {
  try {
    const { medicationId, additionalTablets } = await request.json()
    if (!medicationId || additionalTablets === undefined || Number(additionalTablets) <= 0) {
      return NextResponse.json({ error: 'Valid medicationId and positive additionalTablets are required' }, { status: 400 })
    }

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get current supply
    const { data: currentMed, error: fetchError } = await supabase
      .from('medications')
      .select('tablets_remaining')
      .eq('id', medicationId)
      .eq('user_id', user.id)
      .single()

    if (fetchError || !currentMed) {
      return NextResponse.json({ error: 'Medication not found' }, { status: 404 })
    }

    const currentSupply = Number(currentMed.tablets_remaining ?? 0)
    const newSupply = currentSupply + Number(additionalTablets)

    const { data, error } = await supabase
      .from('medications')
      .update({
        tablets_remaining: newSupply,
      })
      .eq('id', medicationId)
      .eq('user_id', user.id)
      .select()
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, medication: data })
  } catch (err) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
