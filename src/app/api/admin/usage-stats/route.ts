import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const period = searchParams.get('period') || 'month';

    // Validate period
    const validPeriods = ['day', 'month', 'year'];
    if (!validPeriods.includes(period)) {
      return NextResponse.json(
        { success: false, error: 'فترة غير صالحة. استخدم: day, month, year' },
        { status: 400 }
      );
    }

    // Calculate date boundaries based on period
    const now = new Date();
    const periodStart = new Date();

    if (period === 'day') {
      periodStart.setHours(0, 0, 0, 0);
    } else if (period === 'month') {
      periodStart.setMonth(periodStart.getMonth(), 1);
      periodStart.setHours(0, 0, 0, 0);
    } else {
      periodStart.setMonth(0, 1);
      periodStart.setHours(0, 0, 0, 0);
    }

    // Previous period for comparison
    const prevPeriodStart = new Date(periodStart);
    if (period === 'day') {
      prevPeriodStart.setDate(prevPeriodStart.getDate() - 1);
    } else if (period === 'month') {
      prevPeriodStart.setMonth(prevPeriodStart.getMonth() - 1);
    } else {
      prevPeriodStart.setFullYear(prevPeriodStart.getFullYear() - 1);
    }

    const periodStartISO = periodStart.toISOString();
    const prevPeriodStartISO = prevPeriodStart.toISOString();

    // 1. Active lectures count (attendance sessions with status 'active')
    const { count: activeLectures, error: activeLecturesError } = await supabaseServer
      .from('attendance_sessions')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'active');

    if (activeLecturesError) {
      console.error('Error fetching active lectures:', activeLecturesError);
    }

    // 2. Active users - try user_sessions first, fall back to users with updated_at
    let activeUsersCount = 0;
    let prevActiveUsersCount = 0;

    try {
      const { data: activeUserSessions, error: activeUsersError } = await supabaseServer
        .from('user_sessions')
        .select('user_id')
        .gte('last_activity', periodStartISO)
        .eq('is_active', true);

      if (!activeUsersError && activeUserSessions && activeUserSessions.length > 0) {
        const activeUserIds = new Set(activeUserSessions.map((s: { user_id: string }) => s.user_id));
        activeUsersCount = activeUserIds.size;

        const { data: prevActiveUserSessions } = await supabaseServer
          .from('user_sessions')
          .select('user_id')
          .gte('last_activity', prevPeriodStartISO)
          .lt('last_activity', periodStartISO)
          .eq('is_active', true);

        const prevActiveUserIds = new Set((prevActiveUserSessions || []).map((s: { user_id: string }) => s.user_id));
        prevActiveUsersCount = prevActiveUserIds.size;
      } else {
        // Fallback: count users who updated their profile in the period
        // This gives a reasonable approximation of "active" users
        const { count: activeUsersFallback } = await supabaseServer
          .from('users')
          .select('*', { count: 'exact', head: true })
          .gte('updated_at', periodStartISO);

        activeUsersCount = activeUsersFallback || 0;

        const { count: prevActiveUsersFallback } = await supabaseServer
          .from('users')
          .select('*', { count: 'exact', head: true })
          .gte('updated_at', prevPeriodStartISO)
          .lt('updated_at', periodStartISO);

        prevActiveUsersCount = prevActiveUsersFallback || 0;
      }
    } catch {
      // Fallback: use users updated_at
      const { count: activeUsersFallback } = await supabaseServer
        .from('users')
        .select('*', { count: 'exact', head: true })
        .gte('updated_at', periodStartISO);

      activeUsersCount = activeUsersFallback || 0;

      const { count: prevActiveUsersFallback } = await supabaseServer
        .from('users')
        .select('*', { count: 'exact', head: true })
        .gte('updated_at', prevPeriodStartISO)
        .lt('updated_at', periodStartISO);

      prevActiveUsersCount = prevActiveUsersFallback || 0;
    }

    // 3. New registrations in current period
    const { count: newRegistrations, error: regError } = await supabaseServer
      .from('users')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', periodStartISO);

    if (regError) {
      console.error('Error fetching new registrations:', regError);
    }

    // Previous period new registrations
    const { count: prevNewRegistrations } = await supabaseServer
      .from('users')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', prevPeriodStartISO)
      .lt('created_at', periodStartISO);

    // 4. Attendance sessions in current period
    const { count: attendanceSessions, error: sessionsError } = await supabaseServer
      .from('attendance_sessions')
      .select('*', { count: 'exact', head: true })
      .gte('started_at', periodStartISO);

    if (sessionsError) {
      console.error('Error fetching attendance sessions:', sessionsError);
    }

    // Previous period attendance sessions
    const { count: prevAttendanceSessions } = await supabaseServer
      .from('attendance_sessions')
      .select('*', { count: 'exact', head: true })
      .gte('started_at', prevPeriodStartISO)
      .lt('started_at', periodStartISO);

    // 5. Quizzes taken in current period
    const { count: quizzesTaken, error: quizzesError } = await supabaseServer
      .from('scores')
      .select('*', { count: 'exact', head: true })
      .gte('completed_at', periodStartISO);

    if (quizzesError) {
      console.error('Error fetching quizzes taken:', quizzesError);
    }

    // Previous period quizzes taken
    const { count: prevQuizzesTaken } = await supabaseServer
      .from('scores')
      .select('*', { count: 'exact', head: true })
      .gte('completed_at', prevPeriodStartISO)
      .lt('completed_at', periodStartISO);

    // 6. Lectures created in current period
    const { count: lecturesCreated } = await supabaseServer
      .from('lectures')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', periodStartISO);

    const { count: prevLecturesCreated } = await supabaseServer
      .from('lectures')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', prevPeriodStartISO)
      .lt('created_at', periodStartISO);

    // 7. Assignments created in current period
    const { count: assignmentsCreated } = await supabaseServer
      .from('assignments')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', periodStartISO);

    const { count: prevAssignmentsCreated } = await supabaseServer
      .from('assignments')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', prevPeriodStartISO)
      .lt('created_at', periodStartISO);

    // 8. Chart data - daily breakdown for the past 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const thirtyDaysAgoISO = thirtyDaysAgo.toISOString();

    // Fetch raw data for chart
    const [usersData, sessionsData, scoresData] = await Promise.all([
      supabaseServer
        .from('users')
        .select('created_at')
        .gte('created_at', thirtyDaysAgoISO),
      supabaseServer
        .from('attendance_sessions')
        .select('started_at')
        .gte('started_at', thirtyDaysAgoISO),
      supabaseServer
        .from('scores')
        .select('completed_at')
        .gte('completed_at', thirtyDaysAgoISO),
    ]);

    // Build chart data by aggregating counts per day
    const chartData: { date: string; users: number; sessions: number; quizzes: number }[] = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];

      const usersOnDay = (usersData.data || []).filter((u: { created_at: string }) =>
        u.created_at.startsWith(dateStr)
      ).length;

      const sessionsOnDay = (sessionsData.data || []).filter((s: { started_at: string }) =>
        s.started_at.startsWith(dateStr)
      ).length;

      const quizzesOnDay = (scoresData.data || []).filter((s: { completed_at: string }) =>
        s.completed_at.startsWith(dateStr)
      ).length;

      chartData.push({
        date: dateStr,
        users: usersOnDay,
        sessions: sessionsOnDay,
        quizzes: quizzesOnDay,
      });
    }

    // 9. Registration trends chart - monthly for the past 12 months
    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);
    const twelveMonthsAgoISO = twelveMonthsAgo.toISOString();

    const { data: regTrendData } = await supabaseServer
      .from('users')
      .select('created_at')
      .gte('created_at', twelveMonthsAgoISO);

    const registrationTrends: { month: string; count: number; label: string }[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i, 1);
      const year = d.getFullYear();
      const month = d.getMonth();
      const key = `${year}-${String(month + 1).padStart(2, '0')}`;

      const count = (regTrendData || []).filter((u: { created_at: string }) => {
        const uDate = new Date(u.created_at);
        return uDate.getFullYear() === year && uDate.getMonth() === month;
      }).length;

      registrationTrends.push({
        month: key,
        count,
        label: d.toLocaleDateString('ar-SA', { month: 'short', year: 'numeric' }),
      });
    }

    // Calculate percentage changes
    const calcChange = (current: number, previous: number): number => {
      if (previous === 0) return current > 0 ? 100 : 0;
      return Math.round(((current - previous) / previous) * 100);
    };

    return NextResponse.json({
      success: true,
      data: {
        activeLectures: activeLectures || 0,
        period,
        activeUsers: activeUsersCount,
        newRegistrations: newRegistrations || 0,
        attendanceSessions: attendanceSessions || 0,
        quizzesTaken: quizzesTaken || 0,
        lecturesCreated: lecturesCreated || 0,
        assignmentsCreated: assignmentsCreated || 0,
        changes: {
          activeUsers: calcChange(activeUsersCount, prevActiveUsersCount),
          newRegistrations: calcChange(newRegistrations || 0, prevNewRegistrations || 0),
          attendanceSessions: calcChange(attendanceSessions || 0, prevAttendanceSessions || 0),
          quizzesTaken: calcChange(quizzesTaken || 0, prevQuizzesTaken || 0),
          lecturesCreated: calcChange(lecturesCreated || 0, prevLecturesCreated || 0),
          assignmentsCreated: calcChange(assignmentsCreated || 0, prevAssignmentsCreated || 0),
        },
        prevData: {
          activeUsers: prevActiveUsersCount,
          newRegistrations: prevNewRegistrations || 0,
          attendanceSessions: prevAttendanceSessions || 0,
          quizzesTaken: prevQuizzesTaken || 0,
          lecturesCreated: prevLecturesCreated || 0,
          assignmentsCreated: prevAssignmentsCreated || 0,
        },
        chartData,
        registrationTrends,
      },
    });
  } catch (error) {
    console.error('Usage stats fetch error:', error);
    return NextResponse.json(
      { success: false, error: 'حدث خطأ أثناء جلب إحصائيات الاستخدام' },
      { status: 500 }
    );
  }
}
