import { NextRequest, NextResponse } from 'next/server';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { requireSuperAdmin, authErrorResponse } from '@/lib/auth-helpers';

export async function POST(request: NextRequest) {
  // Only superadmins can write to the server's .env file
  const authResult = await requireSuperAdmin(request);
  if (!authResult.success) {
    return authErrorResponse(authResult);
  }

  try {
    const body = await request.json();
    const { supabaseUrl, supabaseAnonKey, supabaseServiceKey } = body;

    // Validate inputs
    if (!supabaseUrl || !supabaseAnonKey) {
      return NextResponse.json(
        { success: false, error: 'يرجى إدخال رابط Supabase ومفتاح الوصول' },
        { status: 400 }
      );
    }

    // Validate URL format
    if (!supabaseUrl.includes('supabase.co')) {
      return NextResponse.json(
        { success: false, error: 'رابط Supabase غير صالح' },
        { status: 400 }
      );
    }

    // Validate key format (JWT-like)
    if (!supabaseAnonKey.startsWith('eyJ')) {
      return NextResponse.json(
        { success: false, error: 'مفتاح الوصول غير صالح' },
        { status: 400 }
      );
    }

    const envPath = join(process.cwd(), '.env');

    // Read existing .env content
    let existingContent = '';
    if (existsSync(envPath)) {
      existingContent = readFileSync(envPath, 'utf-8');
    }

    // Remove old Supabase vars if they exist
    const lines = existingContent.split('\n').filter(
      (line) =>
        !line.startsWith('NEXT_PUBLIC_SUPABASE_URL=') &&
        !line.startsWith('NEXT_PUBLIC_SUPABASE_ANON_KEY=') &&
        !line.startsWith('SUPABASE_SERVICE_ROLE_KEY=')
    );

    // Add new Supabase vars
    const newLines = [
      ...lines.filter((l) => l.trim() !== ''),
      '',
      `NEXT_PUBLIC_SUPABASE_URL=${supabaseUrl}`,
      `NEXT_PUBLIC_SUPABASE_ANON_KEY=${supabaseAnonKey}`,
    ];

    if (supabaseServiceKey) {
      newLines.push(`SUPABASE_SERVICE_ROLE_KEY=${supabaseServiceKey}`);
    }

    newLines.push('');

    // Write back
    writeFileSync(envPath, newLines.join('\n'), 'utf-8');

    return NextResponse.json({
      success: true,
      message: 'تم حفظ إعدادات Supabase بنجاح. يرجى إعادة تحميل الصفحة.',
    });
  } catch (error) {
    console.error('Setup Supabase error:', error);
    return NextResponse.json(
      { success: false, error: 'حدث خطأ أثناء حفظ الإعدادات' },
      { status: 500 }
    );
  }
}
