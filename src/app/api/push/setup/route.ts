import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helpers';

/**
 * GET /api/push/setup
 * Check if push_subscriptions table exists, create it if not.
 * 🔒 SECURITY: Admin-only — exposes database schema details
 *
 * POST /api/push/setup
 * Force create the push_subscriptions table.
 * 🔒 SECURITY: Admin-only — can trigger database table creation
 */

const CREATE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth_key TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  UNIQUE(endpoint)
);

-- Index for fast user lookup
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_id ON public.push_subscriptions(user_id);

-- Enable RLS
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

-- Policy: users can only read their own subscriptions
CREATE POLICY "Users can read own push subscriptions" ON public.push_subscriptions
  FOR SELECT USING (auth.uid() = user_id);

-- Policy: service role can do everything (handled via service key)
CREATE POLICY "Service role full access" ON public.push_subscriptions
  FOR ALL USING (true) WITH CHECK (true);

-- Auto-update updated_at trigger
CREATE OR REPLACE FUNCTION public.update_push_subscriptions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_push_subscriptions_updated_at ON public.push_subscriptions;
CREATE TRIGGER trg_push_subscriptions_updated_at
  BEFORE UPDATE ON public.push_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.update_push_subscriptions_updated_at();
`;

export async function GET(request: NextRequest) {
  // 🔒 SECURITY: Admin-only — exposes database schema DDL
  const authResult = await requireAdmin(request);
  if (!authResult.success) return authErrorResponse(authResult);

  try {
    // Check if table exists by trying to select from it
    const { error } = await supabaseServer
      .from('push_subscriptions')
      .select('id')
      .limit(1);

    if (error && error.code === '42P01') {
      // Table does not exist
      return NextResponse.json({
        exists: false,
        message: 'جدول push_subscriptions غير موجود. استخدم POST لإنشائه.',
      });
    }

    return NextResponse.json({
      exists: true,
      message: 'جدول push_subscriptions موجود بالفعل',
    });
  } catch (error) {
    console.error('Push setup check error:', error);
    return NextResponse.json(
      { error: 'حدث خطأ في التحقق من الجدول' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  // 🔒 SECURITY: Admin-only — can create database tables
  const authResult = await requireAdmin(request);
  if (!authResult.success) return authErrorResponse(authResult);

  try {
    // First check if table already exists
    const { error: checkError } = await supabaseServer
      .from('push_subscriptions')
      .select('id')
      .limit(1);

    if (!checkError) {
      return NextResponse.json({
        success: true,
        message: 'جدول push_subscriptions موجود بالفعل',
      });
    }

    // Table doesn't exist — create it via RPC
    // Supabase doesn't allow raw SQL via the JS client, so we use the REST API
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json(
        { error: 'إعدادات Supabase غير متوفرة' },
        { status: 500 }
      );
    }

    // Try to create the table using the management API
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/exec_sql`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({ query: CREATE_TABLE_SQL }),
    });

    if (!response.ok) {
      // If RPC not available, return the SQL for manual execution (admin-only)
      return NextResponse.json({
        success: false,
        message: 'لا يمكن إنشاء الجدول تلقائياً. يرجى تنفيذ SQL يدوياً في Supabase Dashboard.',
      });
    }

    return NextResponse.json({
      success: true,
      message: 'تم إنشاء جدول push_subscriptions بنجاح',
    });
  } catch (error) {
    console.error('Push setup create error:', error);
    return NextResponse.json(
      { error: 'حدث خطأ في إنشاء الجدول' },
      { status: 500 }
    );
  }
}
