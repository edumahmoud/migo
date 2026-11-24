-- ============================================================
-- v140_legal_documents.sql
-- AttenDo LMS — Editable legal pages (شروط الاستخدام / الاسترجاع / الخصوصية)
--
-- يخزن النص المعدّل لكل صفحة قانونية بصيغة Markdown مبسطة.
-- إذا لم يوجد صف لصفحة معينة تعرض المنصة النص الافتراضي المضمّن في الكود.
--
-- إضافي بالكامل: جدول جديد واحد فقط، لا يعدّل أو يحذف أي شيء موجود.
-- الوصول عبر service_role فقط (واجهات الأدمن في الخادم)، RLS مفعّل بدون سياسات.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.legal_documents (
  slug        TEXT PRIMARY KEY,
  content_md  TEXT NOT NULL,
  updated_by  UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_legal_documents_slug CHECK (slug IN ('terms', 'refund', 'privacy'))
);

ALTER TABLE public.legal_documents ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.legal_documents FROM anon, authenticated;
GRANT ALL ON public.legal_documents TO service_role;
