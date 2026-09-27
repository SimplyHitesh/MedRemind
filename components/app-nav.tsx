'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { signOut } from '@/app/actions/auth'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const navItems = [
  { href: '/dashboard', label: 'Dashboard', icon: '🏠' },
  { href: '/medications', label: 'Medications', icon: '💊' },
  { href: '/settings', label: 'Settings', icon: '⚙️' },
]

export default function AppNav() {
  const pathname = usePathname()

  return (
    <>
      {/* Mobile Top Header */}
      <header className="md:hidden fixed top-0 left-0 right-0 h-14 bg-white border-b border-gray-200 px-4 flex items-center justify-between z-30 shadow-sm">
        <Link href="/dashboard" className="flex items-center gap-2">
          <span className="text-xl">💊</span>
          <span className="font-bold text-base text-gray-900">MedRemind</span>
        </Link>
        <form action={signOut}>
          <Button variant="ghost" size="sm" type="submit" className="text-xs text-gray-500 h-8 px-2">
            Sign out
          </Button>
        </form>
      </header>

      {/* Desktop Left Sidebar */}
      <nav className="hidden md:flex fixed top-0 left-0 h-full w-60 bg-white border-r border-gray-200 flex-col z-30">
        {/* Logo */}
        <div className="p-6 border-b border-gray-100">
          <Link href="/dashboard" className="flex items-center gap-2">
            <span className="text-2xl">💊</span>
            <span className="font-bold text-lg text-gray-900">MedRemind</span>
          </Link>
        </div>

        {/* Nav links */}
        <div className="flex-1 p-4 space-y-1">
          {navItems.map((item) => {
            const isActive =
              item.href === '/dashboard'
                ? pathname === '/dashboard'
                : pathname.startsWith(item.href)
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-blue-50 text-blue-700'
                    : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                )}
              >
                <span className="text-lg">{item.icon}</span>
                {item.label}
              </Link>
            )
          })}
        </div>

        {/* Sign out */}
        <div className="p-4 border-t border-gray-100">
          <form action={signOut}>
            <Button variant="outline" className="w-full" size="sm" type="submit">
              Sign out
            </Button>
          </form>
        </div>
      </nav>

      {/* Mobile Bottom Navigation Bar */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 h-16 bg-white border-t border-gray-200 flex items-center justify-around z-30 px-2 shadow-lg">
        {navItems.map((item) => {
          const isActive =
            item.href === '/dashboard'
              ? pathname === '/dashboard'
              : pathname.startsWith(item.href)
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex flex-col items-center justify-center flex-1 h-full py-1 text-[11px] font-medium transition-colors',
                isActive
                  ? 'text-blue-600 font-semibold'
                  : 'text-gray-500 hover:text-gray-900'
              )}
            >
              <span className="text-xl mb-0.5">{item.icon}</span>
              <span>{item.label}</span>
            </Link>
          )
        })}
      </nav>
    </>
  )
}
