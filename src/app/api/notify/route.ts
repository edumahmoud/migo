import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, requireTeacher, authErrorResponse } from '@/lib/auth-helpers';
import { notifyUser, notifyUsers, getStudentIds } from '@/lib/notifications-service';

// ─── POST handler ───

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action } = body;

    // Determine which actions require teacher role
    const teacherOnlyActions = ['assignment_created', 'attendance_started', 'public_note_created', 'lecture_created', 'assignment_graded'];

    // Authenticate based on action type
    let authResult;
    if (teacherOnlyActions.includes(action)) {
      authResult = await requireTeacher(request);
    } else {
      authResult = await authenticateRequest(request);
    }
    if (!authResult.success) {
      return authErrorResponse(authResult);
    }

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

        const notifTitle = 'محاضرة جديدة';
        const notifMessage = `أنشأ المعلم ${teacherName || 'المعلم'} محاضرة${titleText}${dateTimeText}`;
        const notifLink = `subject:${subjectId}:lectures`;

        await notifyUsers(studentIds, 'lecture', notifTitle, notifMessage, notifLink);

        console.log(`[notify] lecture_created: notified ${studentIds.length} students for subject ${subjectId}`);
        return NextResponse.json({ success: true, notified: studentIds.length });
      }

      // ─── 7) Chat message notification ───
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
