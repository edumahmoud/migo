import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { sendPushNotification, type PushSubscriptionLike } from '@/lib/web-push';

// ─── Notification helpers using service role (bypasses RLS) ───

/**
 * Send a push notification to a specific user.
 * Fetches their push subscriptions from DB and sends to all of them.
 */
async function pushToUser(userId: string, title: string, message: string, url?: string, type?: string) {
  try {
    const { data: subs } = await supabaseServer
      .from('push_subscriptions')
      .select('endpoint, p256dh, auth_key')
      .eq('user_id', userId);

    if (!subs || subs.length === 0) return;

    const payload = { title, message, url: url || '/', type };
    const expiredEndpoints: string[] = [];

    for (const sub of subs) {
      const subscription: PushSubscriptionLike = {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth_key },
      };

      const success = await sendPushNotification(subscription, payload);
      if (!success) {
        // Mark for removal (410 Gone or 404 Not Found)
        expiredEndpoints.push(sub.endpoint);
      }
    }

    // Clean up expired subscriptions
    if (expiredEndpoints.length > 0) {
      for (const endpoint of expiredEndpoints) {
        await supabaseServer
          .from('push_subscriptions')
          .delete()
          .eq('endpoint', endpoint);
      }
      console.log(`[push] Cleaned up ${expiredEndpoints.length} expired subscription(s) for user ${userId}`);
    }
  } catch (err) {
    console.error('[push] Failed to send push notification:', err);
  }
}

/**
 * Send push notifications to multiple users.
 */
async function pushToUsers(userIds: string[], title: string, message: string, url?: string, type?: string) {
  if (userIds.length === 0) return;

  try {
    // Fetch all push subscriptions for these users
    const { data: subs } = await supabaseServer
      .from('push_subscriptions')
      .select('user_id, endpoint, p256dh, auth_key')
      .in('user_id', userIds);

    if (!subs || subs.length === 0) return;

    const payload = { title, message, url: url || '/', type };
    const expiredEndpoints: string[] = [];

    for (const sub of subs) {
      const subscription: PushSubscriptionLike = {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth_key },
      };

      const success = await sendPushNotification(subscription, payload);
      if (!success) {
        expiredEndpoints.push(sub.endpoint);
      }
    }

    // Clean up expired subscriptions
    if (expiredEndpoints.length > 0) {
      for (const endpoint of expiredEndpoints) {
        await supabaseServer
          .from('push_subscriptions')
          .delete()
          .eq('endpoint', endpoint);
      }
      console.log(`[push] Cleaned up ${expiredEndpoints.length} expired subscription(s)`);
    }
  } catch (err) {
    console.error('[push] Failed to send bulk push notifications:', err);
  }
}

async function notifyUser(userId: string, type: string, title: string, message: string, link?: string) {
  try {
    const { error } = await supabaseServer.from('notifications').insert({
      user_id: userId,
      type,
      title,
      message,
      link: link || null,
    });
    if (error) {
      console.error('[notify] Failed to send notification:', error.message, error.details);
    } else {
      // Also send push notification (non-blocking)
      pushToUser(userId, title, message, link, type).catch(() => {});
    }
  } catch (err) {
    console.error('[notify] Failed to send notification (exception):', err);
  }
}

async function notifyUsers(userIds: string[], type: string, title: string, message: string, link?: string) {
  if (userIds.length === 0) return;
  try {
    const rows = userIds.map((userId) => ({
      user_id: userId,
      type,
      title,
      message,
      link: link || null,
    }));
    const { error } = await supabaseServer.from('notifications').insert(rows);
    if (error) {
      console.error('[notify] Failed to send bulk notifications:', error.message, error.details);
      // Fallback: try inserting one by one (in case one bad row blocks the whole batch)
      for (const row of rows) {
        const { error: singleError } = await supabaseServer.from('notifications').insert(row);
        if (singleError) {
          console.error('[notify] Also failed for user', row.user_id, ':', singleError.message);
        }
      }
    } else {
      // Also send push notifications (non-blocking)
      pushToUsers(userIds, title, message, link, type).catch(() => {});
    }
  } catch (err) {
    console.error('[notify] Failed to send bulk notifications (exception):', err);
  }
}

async function getStudentIds(subjectId: string): Promise<string[]> {
  const { data, error } = await supabaseServer
    .from('subject_students')
    .select('student_id')
    .eq('subject_id', subjectId)
    .eq('status', 'approved');

  if (error) {
    console.error('[notify] Failed to fetch student IDs:', error.message);
    // Fallback: try without status filter (in case status column doesn't exist)
    const { data: fallbackData } = await supabaseServer
      .from('subject_students')
      .select('student_id')
      .eq('subject_id', subjectId);
    return (fallbackData || []).map((e: { student_id: string }) => e.student_id);
  }

  return (data || []).map((e: { student_id: string }) => e.student_id);
}

// ─── POST handler ───

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action } = body;

    switch (action) {
      // ─── 1) Teacher creates a new assignment → notify all students ───
      case 'assignment_created': {
        const { subjectId, assignmentTitle, teacherName } = body;
        if (!subjectId || !assignmentTitle) {
          return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
        }

        const studentIds = await getStudentIds(subjectId);
        await notifyUsers(
          studentIds,
          'assignment',
          'مهمة جديدة',
          `أنشأ المعلم ${teacherName || 'المعلم'} مهمة "${assignmentTitle}"`,
          `subject:${subjectId}:assignments`
        );
        return NextResponse.json({ success: true, notified: studentIds.length });
      }

      // ─── 2) Student submits an assignment → notify teacher ───
      case 'assignment_submitted': {
        const { assignmentId, teacherId, studentName, assignmentTitle } = body;
        if (!teacherId || !assignmentTitle) {
          return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
        }

        const { subjectId: submittedSubjectId } = body;
        const submittedLink = submittedSubjectId ? `subject:${submittedSubjectId}:assignments` : `assignment:${assignmentId}`;

        await notifyUser(
          teacherId,
          'assignment',
          'تسليم مهمة جديد',
          `سلم الطالب ${studentName || 'طالب'} مهمة "${assignmentTitle}"`,
          submittedLink
        );
        return NextResponse.json({ success: true });
      }

      // ─── 3) Teacher grades a submission → notify the student ───
      case 'assignment_graded': {
        const { studentId, assignmentTitle, score, maxScore, teacherName, subjectId: gradedSubjectId } = body;
        if (!studentId || !assignmentTitle) {
          return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
        }

        const scoreText = score !== undefined && maxScore !== undefined
          ? ` (${score}/${maxScore})`
          : '';

        const gradedLink = gradedSubjectId ? `subject:${gradedSubjectId}:assignments` : 'assignments';

        await notifyUser(
          studentId,
          'grade',
          'تم تقييم مهمة',
          `قيّم المعلم ${teacherName || 'المعلم'} مهمتك "${assignmentTitle}"${scoreText}`,
          gradedLink
        );
        return NextResponse.json({ success: true });
      }

      // ─── 4) Teacher starts attendance session → notify all students ───
      case 'attendance_started': {
        const { subjectId, subjectName, lectureTitle, teacherName } = body;
        if (!subjectId) {
          return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
        }

        const studentIds = await getStudentIds(subjectId);
        const lectureText = lectureTitle ? ` "${lectureTitle}"` : '';
        await notifyUsers(
          studentIds,
          'attendance',
          'بدأت جلسة حضور',
          `بدأ المعلم ${teacherName || 'المعلم'} جلسة حضور${lectureText} في مقرر "${subjectName || 'المقرر'}"`,
          `subject:${subjectId}:lectures`
        );
        return NextResponse.json({ success: true, notified: studentIds.length });
      }

      // ─── 5) Teacher creates a public note → notify all students ───
      case 'public_note_created': {
        const { subjectId, notePreview, teacherName } = body;
        if (!subjectId) {
          return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
        }

        const studentIds = await getStudentIds(subjectId);
        const previewText = notePreview ? `: ${notePreview}` : '';
        await notifyUsers(
          studentIds,
          'system',
          'ملاحظة جديدة',
          `نشر المعلم ${teacherName || 'المعلم'} ملاحظة جديدة${previewText}`,
          `subject:${subjectId}:notes`
        );
        return NextResponse.json({ success: true, notified: studentIds.length });
      }

      // ─── 6) Teacher creates a new lecture → notify all students ───
      case 'lecture_created': {
        const { subjectId, lectureTitle, teacherName, lectureDate, lectureTime } = body;
        if (!subjectId) {
          return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
        }

        const studentIds = await getStudentIds(subjectId);
        const titleText = lectureTitle ? ` "${lectureTitle}"` : '';

        // Format date and time together
        let dateTimeText = '';
        if (lectureDate && lectureTime) {
          try {
            const formattedDate = new Date(lectureDate).toLocaleDateString('ar-SA', { year: 'numeric', month: 'short', day: 'numeric' });
            const [h, m] = lectureTime.split(':').map(Number);
            const period = h >= 12 ? 'م' : 'ص';
            const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
            const timeStr = `${hour12}:${m.toString().padStart(2, '0')} ${period}`;
            dateTimeText = ` (${formattedDate} - ${timeStr})`;
          } catch {
            dateTimeText = ` (${lectureDate} - ${lectureTime})`;
          }
        } else if (lectureDate) {
          try {
            const formattedDate = new Date(lectureDate).toLocaleDateString('ar-SA', { year: 'numeric', month: 'short', day: 'numeric' });
            dateTimeText = ` (${formattedDate})`;
          } catch {
            dateTimeText = ` (${lectureDate})`;
          }
        } else if (lectureTime) {
          try {
            const [h, m] = lectureTime.split(':').map(Number);
            const period = h >= 12 ? 'م' : 'ص';
            const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
            dateTimeText = ` (${hour12}:${m.toString().padStart(2, '0')} ${period})`;
          } catch {
            dateTimeText = ` (${lectureTime})`;
          }
        }

        let usedType = 'lecture';
        const notifTitle = 'محاضرة جديدة';
        const notifMessage = `أنشأ المعلم ${teacherName || 'المعلم'} محاضرة${titleText}${dateTimeText}`;
        const notifLink = `subject:${subjectId}:lectures`;

        let lectureTypeSupported = true;
        if (studentIds.length > 0) {
          const { error: testError } = await supabaseServer.from('notifications').insert({
            user_id: studentIds[0],
            type: 'lecture',
            title: notifTitle,
            message: notifMessage,
            link: notifLink,
          });
          if (testError) {
            lectureTypeSupported = false;
            usedType = 'system';
          }
        }

        if (lectureTypeSupported) {
          const remainingIds = studentIds.slice(1);
          if (remainingIds.length > 0) {
            await notifyUsers(remainingIds, 'lecture', notifTitle, notifMessage, notifLink);
          }
        } else {
          await notifyUsers(studentIds, 'system', notifTitle, notifMessage, notifLink);
        }

        console.log(`[notify] lecture_created: notified ${studentIds.length} students for subject ${subjectId} (type: ${usedType})`);
        return NextResponse.json({ success: true, notified: studentIds.length, type: usedType });
      }

      // ─── 7) Chat message push notification ───
      case 'chat_message': {
        const { recipientId, senderName, messagePreview, conversationId } = body;
        if (!recipientId) {
          return NextResponse.json({ error: 'Missing recipientId' }, { status: 400 });
        }

        const chatLink = conversationId ? `chat:${conversationId}` : 'chat';

        await notifyUser(
          recipientId,
          'chat',
          `رسالة من ${senderName || 'مستخدم'}`,
          messagePreview || 'لديك رسالة جديدة',
          chatLink
        );
        return NextResponse.json({ success: true });
      }

      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }
  } catch (err) {
    console.error('[notify] Error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
