import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function POST(req: Request) {
  try {
    const { email, password, fullName } = await req.json()

    if (!email || !password) {
      return NextResponse.json(
        { error: 'Email and password are required' },
        { status: 400 }
      )
    }

    if (password.length < 6) {
      return NextResponse.json(
        { error: 'Password must be at least 6 characters' },
        { status: 400 }
      )
    }

    const admin = createAdminClient()

    // Create user with email_confirm: true (bypasses Supabase free tier email rate limits)
    const { data: newUser, error: createError } = await admin.auth.admin.createUser({
      email: email.trim().toLowerCase(),
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName?.trim() || 'User' },
    })

    if (createError || !newUser?.user) {
      const msg = createError?.message || 'Failed to create account'
      const isDuplicate = msg.toLowerCase().includes('already') || msg.toLowerCase().includes('exists')
      return NextResponse.json(
        { error: isDuplicate ? 'An account with this email already exists. Please sign in.' : msg },
        { status: 400 }
      )
    }

    // 3. Ensure profile row exists
    await admin.from('profiles').upsert({
      id: newUser.user.id,
      full_name: fullName?.trim() || 'User',
      timezone: 'Asia/Calcutta',
      updated_at: new Date().toISOString(),
    })

    // 4. Automatically log them in via server cookies
    const supabase = await createClient()
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    })

    if (signInError) {
      // User is created, they can log in via login page
      return NextResponse.json({
        success: true,
        redirect: '/login',
        message: 'Account created! Please sign in.',
      })
    }

    return NextResponse.json({ success: true, redirect: '/dashboard' })
  } catch (err) {
    console.error('Signup error:', err)
    return NextResponse.json(
      { error: (err as Error).message || 'Failed to process signup' },
      { status: 500 }
    )
  }
}
