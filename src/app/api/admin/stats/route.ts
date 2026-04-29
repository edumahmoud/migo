import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helpers';
import { supabaseServer } from '@/lib/supabase-server';

export async function GET(request: NextRequest) {
  const authResult = await requireAdmin(request);
  if (!authResult.success) return authErrorResponse(authResult);

  const supabase = supabaseServer;

  const [users, subjects, quizzes, scores] = await Promise.all([
    supabase.from('users').select('role', { count: 'exact' }),
    supabase.from('subjects').select('id', { count: 'exact' }),
    supabase.from('quizzes').select('id', { count: 'exact' }),
    supabase.from('scores').select('score, total'),
  ]);

  const avgScore = scores.data && scores.data.length > 0
    ? Math.round(scores.data.reduce((sum, s) => sum + (s.score / s.total) * 100, 0) / scores.data.length)
    : 0;

  return NextResponse.json({
    success: true,
    data: {
      totalUsers: users.count || 0,
      teachers: users.data?.filter(u => u.role === 'teacher').length || 0,
      students: users.data?.filter(u => u.role === 'student').length || 0,
      totalSubjects: subjects.count || 0,
      totalQuizzes: quizzes.count || 0,
      avgScore,
    }
  });
}
