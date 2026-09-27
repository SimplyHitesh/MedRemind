import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'MedRemind',
  description: 'Your personal medication reminder',
}

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <>{children}</>
}
