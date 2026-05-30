/**
 * AttenDo — Shared Notification Navigation Utility
 *
 * Centralizes all deep-link navigation logic for notifications.
 * Used by both notification-bell.tsx (dropdown) and notifications-section.tsx (full page)
 * to ensure consistent behavior regardless of where the notification is clicked.
 *
 * Link format conventions:
 *   - Course-specific: `subject:SUBJECT_ID:tab` (e.g., `subject:abc123:assignments`)
 *   - Section-level: `section` (e.g., `assignments`, `files`, `chat`)
 *   - Chat: `chat:CONVERSATION_ID`
 *   - Report: `/reports/REPORT_ID`
 *   - Link request: `link_request:TEACHER_ID`
 *   - File request: `file_request:REQUESTER_ID`
 *   - Profile: `profile:USER_ID`
 *   - Query-style: `subjects?tab=lectures&id=SUBJECT_ID`
 */

import type { CourseTab, NotificationType, UserRole, StudentSection, TeacherSection, AdminSection, AppPage } from '@/lib/types';

// ─── Notification type → default CourseTab mapping ───
// Used when the link format doesn't explicitly encode the tab.
// This ensures every notification type lands on the correct tab.
export const notifTypeToTab: Record<string, CourseTab> = {
  assignment: 'assignments',
  grade: 'assignments',
  enrollment: 'students',
  file: 'files',
  file_request: 'files',
  system: 'overview',
  attendance: 'lectures',
  link_request: 'overview',
  lecture: 'lectures',
  chat: 'overview',
  note: 'notes',
  public_note_created: 'notes',
  report: 'overview',
  poll: 'polls',
  quiz: 'exams',
  team_message: 'teams',
};

// Map of link prefixes to course tabs
// Includes BOTH singular and plural keys because the API generates
// 3-part links like "subject:ID:assignments" (plural) while the prefix
// is "subject" (singular). Both must resolve to the correct CourseTab.
export const linkToTab: Record<string, CourseTab> = {
  enrollment: 'students',
  subject: 'overview',
  overview: 'overview',
  assignment: 'assignments',
  assignments: 'assignments',
  lecture: 'lectures',
  lectures: 'lectures',
  note: 'notes',
  notes: 'notes',
  exam: 'exams',
  exams: 'exams',
  quiz: 'exams',
  file: 'files',
  files: 'files',
  students: 'students',
  teams: 'teams',
  team: 'teams',
  poll: 'polls',
  polls: 'polls',
};

/**
 * Navigate to a notification's deep link target.
 *
 * This is the single source of truth for notification click handling.
 * It updates the app store to navigate to the correct page, section, and tab.
 *
 * @param notif - The notification object
 * @param options - Navigation options
 */
export function navigateNotification(
  notif: {
    id: string;
    type: string;
    title?: string;
    read: boolean;
    link?: string | null;
    message?: string;
  },
  options: {
    userRole: UserRole | undefined;
    userId: string | undefined;
    // App store setters — obtained from useAppStore.getState()
    setSelectedSubjectId: (id: string | null) => void;
    setCourseTab: (tab: CourseTab) => void;
    setStudentSection: (section: StudentSection) => void;
    setTeacherSection: (section: TeacherSection) => void;
    setAdminSection: (section: AdminSection) => void;
    setCurrentPage: (page: AppPage) => void;
    setPendingReportId: (id: string | null) => void;
    openProfile: (userId: string) => void;
    setViewingQuizId?: (id: string | null, reviewMode?: boolean) => void;
    // Translation helper for detecting link_request by title
    t?: (key: string) => string;
  }
): 'handled' | 'link_request' | 'unhandled' {
  const {
    userRole,
    userId,
    setSelectedSubjectId,
    setCourseTab,
    setStudentSection,
    setTeacherSection,
    setAdminSection,
    setCurrentPage,
    setPendingReportId,
    openProfile,
    setViewingQuizId,
    t,
  } = options;

  // ─── 1. Link request notifications — show modal (caller handles) ───
  if (notif.type === 'link_request' || notif.link?.startsWith('link_request:')) {
    return 'link_request';
  }

  // ─── 2. Report notifications — navigate to reports/complaints ───
  if (notif.type === 'report' || notif.link?.startsWith('/reports') || notif.link?.startsWith('report:')) {
    // Extract report ID from link if available
    let reportId: string | null = null;
    if (notif.link) {
      // Format: "/reports/UUID" or "report:UUID"
      const cleanLink = notif.link.replace(/^\//, '');
      const parts = cleanLink.split('/');
      if (parts.length >= 2 && parts[0] === 'reports') {
        reportId = parts[1];
      } else if (notif.link.startsWith('report:')) {
        reportId = notif.link.replace('report:', '');
      }
    }
    if (reportId) {
      setPendingReportId(reportId);
    }

    if (userRole === 'student') {
      setStudentSection('reports' as StudentSection);
      setCurrentPage('student-dashboard');
    } else if (userRole === 'teacher') {
      setTeacherSection('reports' as TeacherSection);
      setCurrentPage('teacher-dashboard');
    } else if (userRole === 'admin' || userRole === 'superadmin') {
      setAdminSection('complaints'); // Admin's complaints section, NOT 'reports' (which is analytics)
      setCurrentPage('admin-dashboard');
    }
    return 'handled';
  }

  // ─── 3. File request notifications — navigate to own profile ───
  if (notif.type === 'file_request' || notif.link?.startsWith('file_request:')) {
    if (userId) openProfile(userId);
    return 'handled';
  }

  // ─── 4. Chat notifications — navigate to main chat section ───
  // Must be checked BEFORE courseLinkPrefix logic because 'chat' is also
  // a valid CourseTab, but chat:CONVERSATION_ID means "open the main chat section"
  if (notif.link?.startsWith('chat:')) {
    if (userRole === 'student') {
      setStudentSection('chat');
      setCurrentPage('student-dashboard');
    } else if (userRole === 'teacher') {
      setTeacherSection('chat');
      setCurrentPage('teacher-dashboard');
    } else if (userRole === 'admin' || userRole === 'superadmin') {
      setAdminSection('chat');
      setCurrentPage('admin-dashboard');
    }
    return 'handled';
  }

  // ─── 4b. Quiz deep links — navigate directly to a specific quiz ───
  // Format: quiz:SUBJECT_ID:QUIZ_ID — opens the quiz directly for the student
  if (notif.link?.startsWith('quiz:') && userRole === 'student') {
    const parts = notif.link.split(':');
    const subjectId = parts[1] || null;
    const quizId = parts[2] || null;

    if (subjectId) {
      setSelectedSubjectId(subjectId);
      setCourseTab('exams');
      setStudentSection('subjects');
    }

    // If we have a quiz ID and the setter, open the quiz directly
    if (quizId && setViewingQuizId) {
      setViewingQuizId(quizId);
    } else {
      // Fallback: just navigate to the exams tab
      setCurrentPage('student-dashboard');
    }
    return 'handled';
  }

  // ─── 5. Course-specific links (prefix:SUBJECT_ID or prefix:SUBJECT_ID:tab) ───
  const courseLinkPrefix = Object.keys(linkToTab).find(prefix => notif.link?.startsWith(prefix + ':'));
  if (courseLinkPrefix) {
    const parts = notif.link!.split(':');
    const subjectId = parts[1] || null;
    const explicitTab = parts[2] || null;

    // Special case: "assignment:ASSIGNMENT_ID" (2-part, no subject context)
    // should navigate to the Assignments section, NOT treat the assignment ID as a subject ID
    if (courseLinkPrefix === 'assignment' && !explicitTab && notif.type === 'assignment') {
      if (userRole === 'student') {
        setStudentSection('assignments');
        setCurrentPage('student-dashboard');
      } else if (userRole === 'teacher') {
        setTeacherSection('assignments');
        setCurrentPage('teacher-dashboard');
      }
      return 'handled';
    }

    if (subjectId) {
      setSelectedSubjectId(subjectId);

      // Determine the correct tab using a priority chain:
      // 1. Explicit tab from 3-part link (e.g. "subject:ID:notes" → 'notes')
      // 2. Notification type mapping (e.g. type='note' → 'notes')
      // 3. Link prefix mapping (e.g. prefix='lecture' → 'lectures')
      let tab: CourseTab;
      if (explicitTab && linkToTab[explicitTab]) {
        tab = linkToTab[explicitTab];
      } else if (notifTypeToTab[notif.type]) {
        tab = notifTypeToTab[notif.type];
      } else {
        tab = linkToTab[courseLinkPrefix];
      }
      setCourseTab(tab);

      // Navigate to the correct dashboard section
      if (userRole === 'student') {
        setStudentSection('subjects');
        setCurrentPage('student-dashboard');
      } else if (userRole === 'teacher') {
        setTeacherSection('subjects');
        setCurrentPage('teacher-dashboard');
      } else if (userRole === 'admin' || userRole === 'superadmin') {
        setAdminSection('subjects');
        setCurrentPage('admin-dashboard');
      }
      return 'handled';
    }
  }

  // ─── 6. Profile links — navigate to user profile ───
  if (notif.link?.startsWith('profile:')) {
    const targetUserId = notif.link.replace('profile:', '');
    if (targetUserId) {
      openProfile(targetUserId);
    }
    return 'handled';
  }

  // ─── 7. Legacy file request notification (link = 'settings') ───
  if (notif.type === 'file' && notif.link === 'settings' && t &&
      (notif.title?.includes(t('notifications.keywordFileRequest')) || notif.title?.includes('طلب ملف'))) {
    if (userId) openProfile(userId);
    return 'handled';
  }

  // ─── 8. Grade notifications with plain link (no prefix) ───
  if (notif.type === 'grade' && notif.link && !notif.link.includes(':')) {
    navigateToSection(notif.link, userRole, setStudentSection, setTeacherSection, setAdminSection, setCurrentPage);
    return 'handled';
  }

  // ─── 9. Generic section links ───
  if (notif.link && notif.link !== 'settings') {
    navigateToSection(notif.link, userRole, setStudentSection, setTeacherSection, setAdminSection, setCurrentPage,
      setSelectedSubjectId, setCourseTab);
    return 'handled';
  }

  return 'unhandled';
}

/**
 * Navigate to a section-level link (e.g., "assignments", "subjects?tab=lectures&id=SUBJECT_ID")
 */
function navigateToSection(
  link: string,
  role: UserRole | undefined,
  setStudentSection: (s: StudentSection) => void,
  setTeacherSection: (s: TeacherSection) => void,
  setAdminSection: (s: AdminSection) => void,
  setCurrentPage: (p: AppPage) => void,
  setSelectedSubjectId?: (id: string | null) => void,
  setCourseTab?: (tab: CourseTab) => void,
) {
  const [section, queryString] = link.startsWith('/') ? link.slice(1).split('?') : link.split('?');
  const params = new URLSearchParams(queryString || '');
  const tab = params.get('tab');
  const subjectId = params.get('id');
  const baseSection = section.includes('/') ? section.split('/')[0] : section;

  // Handle tab-based navigation for subjects
  if (baseSection === 'subjects' && subjectId && setSelectedSubjectId && setCourseTab) {
    setSelectedSubjectId(subjectId);
    if (tab) {
      setCourseTab(tab as CourseTab);
    }
    if (role === 'student') {
      setStudentSection('subjects');
      setCurrentPage('student-dashboard');
    } else if (role === 'teacher') {
      setTeacherSection('subjects');
      setCurrentPage('teacher-dashboard');
    } else if (role === 'admin' || role === 'superadmin') {
      setAdminSection('subjects');
      setCurrentPage('admin-dashboard');
    }
    return;
  }

  if (role === 'student') {
    const validSections: StudentSection[] = ['dashboard', 'subjects', 'summaries', 'quizzes', 'files', 'assignments', 'attendance', 'teachers', 'chat', 'settings', 'notifications', 'reports'];
    if (validSections.includes(baseSection as StudentSection)) {
      setStudentSection(baseSection as StudentSection);
      setCurrentPage('student-dashboard');
    }
  } else if (role === 'teacher') {
    const validSections: TeacherSection[] = ['dashboard', 'subjects', 'students', 'files', 'assignments', 'attendance', 'analytics', 'chat', 'settings', 'notifications', 'reports'];
    if (validSections.includes(baseSection as TeacherSection)) {
      setTeacherSection(baseSection as TeacherSection);
      setCurrentPage('teacher-dashboard');
    }
  } else if (role === 'admin' || role === 'superadmin') {
    const validSections: AdminSection[] = ['dashboard', 'users', 'subjects', 'reports', 'announcements', 'banned', 'institution', 'chat', 'settings', 'comments', 'complaints'];
    const adminSection = (baseSection === 'reports' ? 'complaints' : baseSection) as AdminSection;
    if (validSections.includes(adminSection)) {
      setAdminSection(adminSection);
      setCurrentPage('admin-dashboard');
    }
  }
}
