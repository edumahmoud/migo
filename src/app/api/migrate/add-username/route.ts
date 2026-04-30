import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';

/**
 * GET /api/migrate/add-username
 * Checks migration status and provides SQL for manual execution.
 * POST /api/migrate/add-username
 * Checks and reports migration status.
 */
export async function GET() {
  // Check if username column exists
  const { error: checkError } = await supabaseServer
    .from('users')
    .select('username')
    .limit(1);

  const needsUsername = checkError?.message?.includes('does not exist') || checkError?.code === 'PGRST204';

  const sql = `
-- Migration: Add username column to users table
-- Run this in Supabase SQL Editor (Dashboard > SQL Editor)

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS username TEXT UNIQUE;
`.trim();

  return NextResponse.json({
    needsUsername,
    sql: needsUsername ? sql : null,
    instructions: needsUsername
      ? 'يرجى تشغيل SQL أعلاه في محرر SQL الخاص بـ Supabase'
      : 'العمود موجود بالفعل',
  });
}

export async function POST() {
  const { error: checkError } = await supabaseServer
    .from('users')
    .select('username')
    .limit(1);

  if (checkError?.message?.includes('does not exist') || checkError?.code === 'PGRST204') {
    return NextResponse.json({
      needsUsername: true,
      message: 'يحتاج إضافة يدوية عبر SQL Editor',
      sql: 'ALTER TABLE public.users ADD COLUMN IF NOT EXISTS username TEXT UNIQUE;',
    });
  }

  return NextResponse.json({ needsUsername: false, message: 'العمود موجود بالفعل ✓' });
}
