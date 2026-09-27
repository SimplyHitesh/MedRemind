import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import EditMedicationClient from './edit-client'

interface Props {
  params: Promise<{ id: string }>
}

export default async function EditMedicationPage({ params }: Props) {
  const { id } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: medication, error: medError } = await supabase
    .from('medications')
    .select('*')
    .eq('id', id)
    .single()

  if (medError || !medication) notFound()

  const { data: schedules } = await supabase
    .from('schedules')
    .select('*')
    .eq('medication_id', id)
    .eq('is_active', true)
    .order('time_of_day')

  return (
    <EditMedicationClient
      medication={medication}
      originalSchedules={schedules ?? []}
    />
  )
}
