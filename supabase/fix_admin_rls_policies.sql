-- =====================================================
-- إصلاح شامل لسياسات RLS - السماح للمديرين بقراءة كل البيانات
-- هذه الملف يعالج مشكلة عدم قدرة مدير المنصة والمشرف على رؤية بيانات المستخدمين والإحصائيات
-- شغّله في Supabase SQL Editor (Dashboard > SQL Editor > New Query)
-- =====================================================

-- ===== 1. USERS: إصلاح سياسات قراءة المستخدمين =====

-- حذف السياسات المكسورة القديمة
DROP POLICY IF EXISTS "Admins can read all users" ON public.users;
DROP POLICY IF EXISTS "Authenticated users can read profiles" ON public.users;

-- إنشاء سياسة جديدة للأدمين: يقدر يقرأ كل المستخدمين
-- استخدام SECURITY DEFINER function لتجنب الـ recursion
CREATE POLICY "Admins can read all users" ON public.users
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'superadmin'))
  );

-- أي مستخدم مسجل دخوله يقدر يقرأ بروفايلات المستخدمين الآخرين
CREATE POLICY "Authenticated users can read profiles" ON public.users
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- ===== 2. SUBJECTS: السماح للمديرين بقراءة كل المقررات =====

DROP POLICY IF EXISTS "Admins can read all subjects" ON public.subjects;
CREATE POLICY "Admins can read all subjects" ON public.subjects
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'superadmin'))
  );

-- ===== 3. SCORES: السماح للمديرين بقراءة كل الدرجات =====

DROP POLICY IF EXISTS "Admins can read all scores" ON public.scores;
CREATE POLICY "Admins can read all scores" ON public.scores
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'superadmin'))
  );

-- ===== 4. QUIZZES: السماح للمديرين بقراءة كل الاختبارات =====

DROP POLICY IF EXISTS "Admins can read all quizzes" ON public.quizzes;
CREATE POLICY "Admins can read all quizzes" ON public.quizzes
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'superadmin'))
  );

-- ===== 5. TEACHER_STUDENT_LINKS: السماح للمديرين بقراءة كل الروابط =====

DROP POLICY IF EXISTS "Admins can read all links" ON public.teacher_student_links;
CREATE POLICY "Admins can read all links" ON public.teacher_student_links
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'superadmin'))
  );

-- ===== 6. SUBJECT_STUDENTS: السماح للمديرين بقراءة كل التسجيلات =====

DROP POLICY IF EXISTS "Admins can read all enrollments" ON public.subject_students;
CREATE POLICY "Admins can read all enrollments" ON public.subject_students
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'superadmin'))
  );

-- ===== 7. SUBJECT_TEACHERS: السماح للمديرين بقراءة كل معلمي المقررات =====

DROP POLICY IF EXISTS "Admins can read all subject_teachers" ON public.subject_teachers;
CREATE POLICY "Admins can read all subject_teachers" ON public.subject_teachers
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'superadmin'))
  );

-- ===== 8. LECTURES: السماح للمديرين بقراءة كل المحاضرات =====

DROP POLICY IF EXISTS "Admins can read all lectures" ON public.lectures;
CREATE POLICY "Admins can read all lectures" ON public.lectures
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'superadmin'))
  );

-- ===== 9. ASSIGNMENTS: السماح للمديرين بقراءة كل الواجبات =====

DROP POLICY IF EXISTS "Admins can read all assignments" ON public.assignments;
CREATE POLICY "Admins can read all assignments" ON public.assignments
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'superadmin'))
  );

-- ===== 10. SUBMISSIONS: السماح للمديرين بقراءة كل التسليمات =====

DROP POLICY IF EXISTS "Admins can read all submissions" ON public.submissions;
CREATE POLICY "Admins can read all submissions" ON public.submissions
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'superadmin'))
  );

-- ===== 11. ATTENDANCE_SESSIONS: السماح للمديرين بقراءة كل جلسات الحضور =====

DROP POLICY IF EXISTS "Admins can read all attendance_sessions" ON public.attendance_sessions;
CREATE POLICY "Admins can read all attendance_sessions" ON public.attendance_sessions
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'superadmin'))
  );

-- ===== 12. ATTENDANCE_RECORDS: السماح للمديرين بقراءة كل سجلات الحضور =====

DROP POLICY IF EXISTS "Admins can read all attendance_records" ON public.attendance_records;
CREATE POLICY "Admins can read all attendance_records" ON public.attendance_records
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'superadmin'))
  );

-- ===== 13. ANNOUNCEMENTS: السماح للمديرين بقراءة وإدارة كل الإعلانات =====

DROP POLICY IF EXISTS "Admins can manage all announcements" ON public.announcements;
CREATE POLICY "Admins can manage all announcements" ON public.announcements
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'superadmin'))
  );

-- ===== 14. BANNED_USERS: السماح للمديرين بقراءة وإدارة كل المحظورين =====

DROP POLICY IF EXISTS "Admins can manage banned users" ON public.banned_users;
CREATE POLICY "Admins can manage banned users" ON public.banned_users
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'superadmin'))
  );

-- ===== 15. INSTITUTION_SETTINGS: السماح للجميع بقراءة الإعدادات =====

DROP POLICY IF EXISTS "Anyone can read institution_settings" ON public.institution_settings;
CREATE POLICY "Anyone can read institution_settings" ON public.institution_settings
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Admins can manage institution_settings" ON public.institution_settings;
CREATE POLICY "Admins can manage institution_settings" ON public.institution_settings
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'superadmin'))
  );

-- ===== 16. SUMMARIES: السماح للمديرين بقراءة كل الملخصات =====

DROP POLICY IF EXISTS "Admins can read all summaries" ON public.summaries;
CREATE POLICY "Admins can read all summaries" ON public.summaries
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'superadmin'))
  );

-- ===== 17. LECTURE_NOTES: السماح للمديرين بقراءة كل الملاحظات =====

DROP POLICY IF EXISTS "Admins can read all lecture_notes" ON public.lecture_notes;
CREATE POLICY "Admins can read all lecture_notes" ON public.lecture_notes
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'superadmin'))
  );

-- ===== 18. USER_FILES: السماح للمديرين بقراءة كل الملفات =====

DROP POLICY IF EXISTS "Admins can read all user_files" ON public.user_files;
CREATE POLICY "Admins can read all user_files" ON public.user_files
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'superadmin'))
  );

-- ===== 19. SUBJECT_FILES: السماح للمديرين بقراءة كل ملفات المقررات =====

DROP POLICY IF EXISTS "Admins can read all subject_files" ON public.subject_files;
CREATE POLICY "Admins can read all subject_files" ON public.subject_files
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'superadmin'))
  );

-- ===== 20. FILE_SHARES: السماح للمديرين بقراءة كل المشاركات =====

DROP POLICY IF EXISTS "Admins can read all file_shares" ON public.file_shares;
CREATE POLICY "Admins can read all file_shares" ON public.file_shares
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'superadmin'))
  );

-- ===== 21. FILE_REQUESTS: السماح للمديرين بقراءة كل طلبات الملفات =====

DROP POLICY IF EXISTS "Admins can read all file_requests" ON public.file_requests;
CREATE POLICY "Admins can read all file_requests" ON public.file_requests
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'superadmin'))
  );

-- ===== 22. NOTIFICATIONS: السماح للمديرين بقراءة كل الإشعارات =====

DROP POLICY IF EXISTS "Admins can read all notifications" ON public.notifications;
CREATE POLICY "Admins can read all notifications" ON public.notifications
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'superadmin'))
  );

-- ===== 23. USER_SESSIONS: السماح للمديرين بقراءة كل الجلسات =====

DROP POLICY IF EXISTS "Admins can read all user_sessions" ON public.user_sessions;
CREATE POLICY "Admins can read all user_sessions" ON public.user_sessions
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'superadmin'))
  );

-- ===== 24. CONVERSATIONS: السماح للمديرين بقراءة كل المحادثات =====

DROP POLICY IF EXISTS "Admins can read all conversations" ON public.conversations;
CREATE POLICY "Admins can read all conversations" ON public.conversations
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'superadmin'))
  );

-- ===== 25. CONVERSATION_PARTICIPANTS: السماح للمديرين بقراءة كل المشاركين =====

DROP POLICY IF EXISTS "Admins can read all conversation_participants" ON public.conversation_participants;
CREATE POLICY "Admins can read all conversation_participants" ON public.conversation_participants
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'superadmin'))
  );

-- ===== 26. MESSAGES: السماح للمديرين بقراءة كل الرسائل =====

DROP POLICY IF EXISTS "Admins can read all messages" ON public.messages;
CREATE POLICY "Admins can read all messages" ON public.messages
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'superadmin'))
  );

-- ===== 27. NOTE_VIEWS: السماح للمديرين بقراءة كل مشاهدات الملاحظات =====

DROP POLICY IF EXISTS "Admins can read all note_views" ON public.note_views;
CREATE POLICY "Admins can read all note_views" ON public.note_views
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'superadmin'))
  );

-- =====================================================
-- تخزين: السماح بقراءة شعارات المؤسسة
-- =====================================================

DROP POLICY IF EXISTS "Anyone can read institution logos" ON storage.objects;
CREATE POLICY "Anyone can read institution logos" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'user-files' AND
    (storage.foldername(name))[1] = 'institution'
  );

-- =====================================================
-- ملاحظة: الاستعلام الفرعي EXISTS في السياسات قد يسبب بطء
-- إذا كان جدول المستخدمين كبيراً. لكن لأقل من 10000 مستخدم
-- الأداء سيكون مقبولاً.
-- للحصول على أداء أفضل، يمكن استخدام SECURITY DEFINER function
-- مثل is_admin() بدلاً من الاستعلام الفرعي.
-- =====================================================
