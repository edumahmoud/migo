import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';

// Allowed fields that can be updated
const ALLOWED_FIELDS = ['name', 'gender', 'title_id', 'avatar_url', 'username'] as const;
type AllowedField = (typeof ALLOWED_FIELDS)[number];

// Input sanitization
function sanitizeInput(input: string): string {
  return input.replace(/<[^>]*>/g, '').trim();
}

function isValidName(name: string): boolean {
  const sanitized = sanitizeInput(name);
  return sanitized.length > 0 && sanitized.length <= 100;
}

const VALID_GENDERS = ['male', 'female'];
const VALID_TITLES = ['teacher', 'dr', 'prof', 'assoc_prof', 'assist_prof', 'lecturer', 'teaching_assist'];

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { userId, updates } = body as { userId?: string; updates?: Record<string, unknown> };

    if (!userId) {
      return NextResponse.json({ error: 'معرف المستخدم مطلوب' }, { status: 401 });
    }

    if (!updates || typeof updates !== 'object') {
      return NextResponse.json({ error: 'بيانات التحديث مطلوبة' }, { status: 400 });
    }

    // Filter and validate updates - only allow specific fields
    const sanitizedUpdates: Record<string, unknown> = {};

    for (const key of Object.keys(updates)) {
      if (!ALLOWED_FIELDS.includes(key as AllowedField)) {
        continue; // Skip disallowed fields
      }

      const value = updates[key];

      switch (key) {
        case 'name':
          if (typeof value !== 'string' || !isValidName(value)) {
            return NextResponse.json({ error: 'يرجى إدخال اسم صالح' }, { status: 400 });
          }
          sanitizedUpdates.name = sanitizeInput(value);
          break;

        case 'gender':
          if (value === null || value === '') {
            sanitizedUpdates.gender = null;
          } else if (typeof value === 'string' && VALID_GENDERS.includes(value)) {
            sanitizedUpdates.gender = value;
          } else {
            return NextResponse.json({ error: 'قيمة الجنس غير صالحة' }, { status: 400 });
          }
          break;

        case 'title_id':
          if (value === null || value === '') {
            sanitizedUpdates.title_id = null;
          } else if (typeof value === 'string' && VALID_TITLES.includes(value)) {
            sanitizedUpdates.title_id = value;
          } else {
            return NextResponse.json({ error: 'قيمة اللقب الأكاديمي غير صالحة' }, { status: 400 });
          }
          break;

        case 'avatar_url':
          if (typeof value === 'string') {
            // Guard: reject institution logo URLs — they must not be stored as user avatar_url
            if (value.includes('/institution/logos/') || value.includes('/institution%2Flogos%2F')) {
              return NextResponse.json({ error: 'لا يمكن استخدام شعار المؤسسة كصورة شخصية' }, { status: 400 });
            }
            sanitizedUpdates.avatar_url = value;
          } else if (value === null) {
            sanitizedUpdates.avatar_url = null;
          }
          break;

        case 'username':
          if (typeof value === 'string') {
            const clean = value.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
            if (clean.length < 3 || clean.length > 30) {
              return NextResponse.json({ error: 'اسم المستخدم يجب أن يكون بين 3 و 30 حرف' }, { status: 400 });
            }
            sanitizedUpdates.username = clean;
          } else if (value === null) {
            sanitizedUpdates.username = null;
          }
          break;
      }
    }

    if (Object.keys(sanitizedUpdates).length === 0) {
      return NextResponse.json({ error: 'لا توجد بيانات للتحديث' }, { status: 400 });
    }

    // Use service role key to bypass RLS
    const { data: updatedProfile, error: updateError } = await supabaseServer
      .from('users')
      .update(sanitizedUpdates)
      .eq('id', userId)
      .select()
      .single();

    if (updateError) {
      // If username column doesn't exist, retry without it
      if (updateError.message?.includes('username') || updateError.code === 'PGRST204') {
        const { username, ...updatesWithoutUsername } = sanitizedUpdates;
        if (Object.keys(updatesWithoutUsername).length === 0) {
          // Only username was being updated but column doesn't exist
          return NextResponse.json({ 
            success: false, 
            error: 'عمود اسم المستخدم غير موجود بعد. يرجى تشغيل ترحيل قاعدة البيانات أولاً.',
            needsMigration: true,
          }, { status: 400 });
        }
        const { data: retryProfile, error: retryError } = await supabaseServer
          .from('users')
          .update(updatesWithoutUsername)
          .eq('id', userId)
          .select()
          .single();
        
        if (retryError) {
          console.error('Profile update retry error:', retryError);
          return NextResponse.json({ error: 'حدث خطأ أثناء تحديث الملف الشخصي' }, { status: 500 });
        }
        return NextResponse.json({ success: true, data: retryProfile });
      }
      console.error('Profile update error:', updateError);
      return NextResponse.json({ error: 'حدث خطأ أثناء تحديث الملف الشخصي' }, { status: 500 });
    }

    return NextResponse.json({ success: true, data: updatedProfile });
  } catch (error) {
    console.error('Profile API error:', error);
    return NextResponse.json({ error: 'حدث خطأ غير متوقع' }, { status: 500 });
  }
}
