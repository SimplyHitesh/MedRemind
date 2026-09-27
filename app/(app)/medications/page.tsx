import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import MedicationsClient from './medications-client'

export default async function MedicationsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { data: medications } = await supabase
    .from('medications')
    .select('*')
    .order('created_at', { ascending: false })

  return <MedicationsClient initialMedications={medications ?? []} />
}
