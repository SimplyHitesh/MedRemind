import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import AppNav from '@/components/app-nav'
import { Toaster } from '@/components/ui/sonner'

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  return (
    <div className="flex min-h-screen bg-gray-50 flex-col md:flex-row">
      <AppNav />
      <main className="flex-1 w-full max-w-full md:ml-60 p-4 sm:p-6 md:p-8 pt-16 md:pt-8 pb-24 md:pb-8 min-h-screen overflow-x-hidden">
        {children}
      </main>
      <Toaster richColors position="top-right" />
    </div>
  )
}
