import { createClient } from '@/lib/supabase/server'
import { NextResponse, type NextRequest } from 'next/server'

export async function POST(request: NextRequest) {
  try {
    const { medicationId, newEndDate, newDoseAmount, newTabletsPerDose } = await request.json()
    if (!medicationId) {
      return NextResponse.json({ error: 'medicationId is required' }, { status: 400 })
    }

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const updatePayload: Record<string, unknown> = {}
    if (newEndDate !== undefined) {
      updatePayload.duration_end_date = newEndDate || null
    }
    if (newDoseAmount !== undefined && Number(newDoseAmount) > 0) {
      updatePayload.dose_amount = Number(newDoseAmount)
    }
    if (newTabletsPerDose !== undefined && Number(newTabletsPerDose) > 0) {
      updatePayload.tablets_per_dose = Number(newTabletsPerDose)
    }

    const { data: updatedMed, error: medError } = await supabase
      .from('medications')
      .update(updatePayload)
      .eq('id', medicationId)
      .eq('user_id', user.id)
      .select()
      .single()

    if (medError) {
      return NextResponse.json({ error: medError.message }, { status: 500 })
    }

    // Also update schedules end_date if newEndDate was modified
    if (newEndDate !== undefined) {
      await supabase
        .from('schedules')
        .update({ end_date: newEndDate || null })
        .eq('medication_id', medicationId)
        .eq('user_id', user.id)
    }

    return NextResponse.json({ success: true, medication: updatedMed })
  } catch (err) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
