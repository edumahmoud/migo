-- =============================================================
-- v134q_storage_subscription.sql
-- AttenDo LMS — Storage subscriptions (time-based)
--
-- يضيف دعم الاشتراكات الزمنية للتخزين (شهري/سنوي) بجانب
-- الترقيات الدائمة الموجودة في user_storage_upgrades.
--
-- النموذج:
--   - storage_plans يصف الخطة (50GB / 200GB / ...).
--   - storage_subscriptions يسجّل اشتراك المستخدم في خطة مع
--     فترة زمنية (شهر/سنة) وحالة (active/expired/pending).
--   - الدالة effective_storage_quota() تحسب الحصة الفعلية:
--     (الحصة المجانية) + (مجموع الترقيات الدائمة النشطة)
--     + (مجموع الاشتراكات الزمنية النشطة).
--
-- هذا الترحيل متوافق مع v134i و v134l ولا يحذف أو يعدّل أي شيء
-- موجود — فقط يضيف جدولاً جديداً ودالة مساعدة.
-- =============================================================

-- 1. جدول اشتراكات التخزين الزمنية
CREATE TABLE IF NOT EXISTS public.storage_subscriptions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  plan_id           UUID NOT NULL REFERENCES public.storage_plans(id) ON DELETE CASCADE,
  size_mb           INTEGER NOT NULL,                      -- لقطة من حجم الخطة وقت الاشتراك
  price             NUMERIC(10,2) NOT NULL,                -- لقطة من السعر وقت الاشتراك
  currency          TEXT NOT NULL DEFAULT 'EGP',
  period            TEXT NOT NULL DEFAULT 'monthly',       -- 'monthly' | 'yearly'
  status            TEXT NOT NULL DEFAULT 'pending',       -- 'pending' | 'active' | 'expired' | 'cancelled'
  started_at        TIMESTAMPTZ,                           -- بداية الفعالية (عند التفعيل)
  expires_at        TIMESTAMPTZ,                           -- نهاية الفترة
  request_id        UUID,                                  -- رابط بطلب التفعيل في section_activation_requests
  payment_order_id  UUID,                                  -- رابط بجدول الطلبات (orders) إن وُجد
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- فهرسة سريعة لاستعلام اشتراكات مستخدم
CREATE INDEX IF NOT EXISTS idx_storage_subscriptions_user
  ON public.storage_subscriptions(user_id, status);

CREATE INDEX IF NOT EXISTS idx_storage_subscriptions_expires
  ON public.storage_subscriptions(expires_at)
  WHERE status = 'active';

-- قيد على قيم status
DO $$
BEGIN
  ALTER TABLE public.storage_subscriptions
    DROP CONSTRAINT IF EXISTS chk_storage_sub_status;
  ALTER TABLE public.storage_subscriptions
    ADD CONSTRAINT chk_storage_sub_status CHECK (
      status IN ('pending', 'active', 'expired', 'cancelled')
    );
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

-- قيد على قيم period
DO $$
BEGIN
  ALTER TABLE public.storage_subscriptions
    DROP CONSTRAINT IF EXISTS chk_storage_sub_period;
  ALTER TABLE public.storage_subscriptions
    ADD CONSTRAINT chk_storage_sub_period CHECK (
      period IN ('monthly', 'yearly')
    );
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

-- 2. RLS
ALTER TABLE public.storage_subscriptions ENABLE ROW LEVEL SECURITY;

-- المستخدم يرى اشتراكاته فقط، والمدير يرى الكل
DROP POLICY IF EXISTS "Users read own storage subscriptions" ON public.storage_subscriptions;
CREATE POLICY "Users read own storage subscriptions"
  ON public.storage_subscriptions FOR SELECT
  USING (user_id = auth.uid() OR public.is_admin());

-- المستخدم يمكنه إنشاء اشتراك لنفسه فقط
DROP POLICY IF EXISTS "Users insert own storage subscriptions" ON public.storage_subscriptions;
CREATE POLICY "Users insert own storage subscriptions"
  ON public.storage_subscriptions FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- المستخدم يمكنه تعديل اشتراكاته (مثلاً إلغاء)
DROP POLICY IF EXISTS "Users update own storage subscriptions" ON public.storage_subscriptions;
CREATE POLICY "Users update own storage subscriptions"
  ON public.storage_subscriptions FOR UPDATE
  USING (user_id = auth.uid() OR public.is_admin());

-- 3. Trigger لتحديث updated_at تلقائياً
CREATE OR REPLACE FUNCTION public.touch_storage_subscriptions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_storage_subscriptions_updated_at ON public.storage_subscriptions;
CREATE TRIGGER trg_storage_subscriptions_updated_at
  BEFORE UPDATE ON public.storage_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.touch_storage_subscriptions_updated_at();

-- 4. دالة لتحديث الاشتراكات المنتهية تلقائياً (تُستدعى يدوياً أو بـ cron)
-- تمرّر الاشتراكات active التي انتهت صلاحيتها إلى status='expired'
CREATE OR REPLACE FUNCTION public.expire_storage_subscriptions()
RETURNS INTEGER AS $$
DECLARE
  affected INTEGER;
BEGIN
  UPDATE public.storage_subscriptions
  SET status = 'expired'
  WHERE status = 'active'
    AND expires_at IS NOT NULL
    AND expires_at < now();
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$ LANGUAGE plpgsql;

-- 5. دالة لحساب الحصة الفعلية لمستخدم (مجاني + دائم + اشتراكات نشطة)
CREATE OR REPLACE FUNCTION public.effective_storage_quota(p_user_id UUID)
RETURNS BIGINT AS $$
DECLARE
  free_quota   BIGINT := 0;
  permanent_mb BIGINT := 0;
  sub_mb       BIGINT := 0;
  cfg          RECORD;
BEGIN
  -- الحصة المجانية من إعدادات القسم
  SELECT student_monthly_limit INTO cfg
  FROM public.locked_sections_config
  WHERE section_key = 'files'
  LIMIT 1;
  free_quota := COALESCE(cfg.student_monthly_limit, 100)::BIGINT * 1024; -- MB → ... نتركها بالميجابايت

  -- الترقيات الدائمة النشطة
  SELECT COALESCE(SUM(size_mb), 0) INTO permanent_mb
  FROM public.user_storage_upgrades
  WHERE user_id = p_user_id AND is_active = true;

  -- الاشتراكات الزمنية النشطة
  SELECT COALESCE(SUM(size_mb), 0) INTO sub_mb
  FROM public.storage_subscriptions
  WHERE user_id = p_user_id AND status = 'active';

  RETURN (free_quota + permanent_mb + sub_mb);
END;
$$ LANGUAGE plpgsql STABLE;

-- 6. تعليقات توثيقية
COMMENT ON TABLE public.storage_subscriptions IS
  'اشتراكات تخزين زمنية (شهرية/سنوية) بجانب الترقيات الدائمة في user_storage_upgrades';
COMMENT ON COLUMN public.storage_subscriptions.period IS 'monthly أو yearly';
COMMENT ON COLUMN public.storage_subscriptions.status IS 'pending أو active أو expired أو cancelled';
COMMENT ON FUNCTION public.expire_storage_subscriptions() IS
  'تنتهي تلقائياً صلاحية الاشتراكات النشطة التي انتهى وقتها — تُستدعى بـ cron يومياً';
COMMENT ON FUNCTION public.effective_storage_quota(UUID) IS
  'تحسب الحصة الكلية للمستخدم = مجاني + دائم + اشتراكات نشطة (بالميجابايت)';

-- 7. تحقق
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'storage_subscriptions'
ORDER BY ordinal_position;
