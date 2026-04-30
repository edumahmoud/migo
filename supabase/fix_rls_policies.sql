-- =====================================================
-- إصلاح سياسات RLS للمستخدمين
-- هذه الملف يعالج مشكلة عدم قدرة الحسابات على رؤية بيانات بعضها البعض
-- شغّله في Supabase SQL Editor (Dashboard > SQL Editor > New Query)
-- =====================================================

-- 1. حذف سياسة "Admins can read all users" القديمة والمكسورة
DROP POLICY IF EXISTS "Admins can read all users" ON public.users;

-- 2. إنشاء سياسة جديدة وصحيحة للأدمين: يقدر يقرأ كل المستخدمين
CREATE POLICY "Admins can read all users" ON public.users
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin', 'superadmin'))
  );

-- 3. إضافة سياسة جديدة: أي مستخدم مسجل دخوله يقدر يقرأ بروفايلات المستخدمين الآخرين
-- هذا مهم عشان الطلاب يقدروا يشوفوا بروفايلات المعلمين وزمايلهم
DROP POLICY IF EXISTS "Authenticated users can read profiles" ON public.users;
CREATE POLICY "Authenticated users can read profiles" ON public.users
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- 4. حذف سياسة "Anyone authenticated can find teachers" لأنها أصبحت مكررة
-- (السياسة الجديدة "Authenticated users can read profiles" تغني عنها)
-- لكن نحتفظ بها للتوافقية مع الكود القديم - لا نحذفها

-- =====================================================
-- ملاحظة: إذا كنت تواجه مشاكل في جداول أخرى أيضاً،
-- جرب تشغيل السياسات التالية:
-- =====================================================

-- إصلاح سياسة institution_settings: السماح لأي مستخدم بقراءة الإعدادات
DROP POLICY IF EXISTS "Anyone can read institution_settings" ON public.institution_settings;
CREATE POLICY "Anyone can read institution_settings" ON public.institution_settings
  FOR SELECT USING (true);

-- إصلاح سياسة announcements: السماح لأي مستخدم بقراءة الإعلانات النشطة
DROP POLICY IF EXISTS "Anyone can read active announcements" ON public.announcements;
CREATE POLICY "Anyone can read active announcements" ON public.announcements
  FOR SELECT USING (is_active = true);

-- =====================================================
-- 5. إضافة سياسة تخزين لشعارات المؤسسة
-- (مطلوبة لعرض الشعار في صفحات تسجيل الدخول)
-- =====================================================

DROP POLICY IF EXISTS "Anyone can read institution logos" ON storage.objects;
CREATE POLICY "Anyone can read institution logos" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'user-files' AND
    (storage.foldername(name))[1] = 'institution'
  );
