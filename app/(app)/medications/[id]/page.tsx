import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import MedicationDetailsClient from './details-client'

interface Props {
  params: Promise<{ id: string }>
}

export default async function MedicationDetailsPage({ params }: Props) {
  const { id } = await params
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { data: medication, error: medError } = await supabase
    .from('medications')
    .select('*')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (medError || !medication) notFound()

  const { data: schedules } = await supabase
    .from('schedules')
    .select('*')
    .eq('medication_id', id)
    .order('time_of_day')

  return (
    <MedicationDetailsClient
      medication={medication}
      schedules={schedules ?? []}
    />
  )
}
