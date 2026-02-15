import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export async function POST() {
  try {
    const supabase = createServiceClient()
    
    // Check if user is authenticated
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    
    if (authError || !user) {
      return NextResponse.json({ isAdmin: false, error: 'Not authenticated' }, { status: 401 })
    }
    
    // Check user role
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()
    
    if (profileError) {
      return NextResponse.json({ isAdmin: false, error: 'Profile not found' }, { status: 404 })
    }
    
    return NextResponse.json({ 
      isAdmin: profile.role === 'admin',
      role: profile.role 
    })
    
  } catch (error) {
    console.error('Error checking admin role:', error)
    return NextResponse.json({ isAdmin: false, error: 'Internal server error' }, { status: 500 })
  }
}

export async function GET() {
  return POST()
}
