import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import ExplainClient from './explain-client'

interface Props {
  params: Promise<{ id: string }>
}

export default async function ExplainPage({ params }: Props) {
  const { id } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: medication, error } = await supabase
    .from('medications')
    .select('id, name')
    .eq('id', id)
    .single()

  if (error || !medication) notFound()

  return <ExplainClient medicationId={medication.id} medicationName={medication.name} />
}
