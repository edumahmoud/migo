import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helpers';
import { supabaseServer } from '@/lib/supabase-server';

// This API route handles admin user management
// It uses the Supabase service role key to bypass RLS

export async function GET(request: NextRequest) {
  const authResult = await requireAdmin(request);
  if (!authResult.success) return authErrorResponse(authResult);

  // Fetch all users using service role
  const supabase = supabaseServer;

  const { data, error } = await supabase
    .from('users')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, data });
}

export async function DELETE(request: NextRequest) {
  const authResult = await requireAdmin(request);
  if (!authResult.success) return authErrorResponse(authResult);

  const { userId } = await request.json();
  const supabase = supabaseServer;

  const { error } = await supabase.from('users').delete().eq('id', userId);
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
