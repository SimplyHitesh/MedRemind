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
    <nav className="fixed top-0 left-0 h-full w-60 bg-white border-r border-gray-200 flex flex-col z-10">
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
  )
}
