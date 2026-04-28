---
Task ID: 1
Agent: Main
Task: إصلاح 4 مشاكل: جلب الملفات المشاركة + زر رفع الكل + معاينة الملف + إشعارات Push

Work Log:
- قراءة وتحليل الملفات المصدرية بالكامل لفهم المشاكل الحقيقية
- إصلاح fetchSharedFiles: إضافة Authorization header للعمل على الموبايل
- تحديث API route shared-with-me: دعم token-based auth بجانب cookie-based
- إصلاح زر رفع الكل: إظهار الزر للملفات الفاشلة + إعادة محاولة تلقائية + touch-manipulation
- تحسين معاينة الملف: إضافة دعم فيديو وصوت + رسالة تحميل للأنواع غير المدعومة
- إضافة NotificationPermission component في app-header لتفعيل إشعارات Push
- Push إلى GitHub بنجاح

Stage Summary:
- الملفات المعدلة: shared-with-me/route.ts, personal-files-section.tsx, app-header.tsx
- المشكلة الجذرية للملفات المشاركة: API كان بيعتمد على cookies فقط واللي بتفشل على الموبايل
- إشعارات Push: البنية التحتية كانت موجودة بالكامل بس مكوّن التفعيل كان مش موجود في الـ UI
