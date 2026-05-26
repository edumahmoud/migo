-- ============================================================
-- Migration: v51_platform_announcements
-- Description: Create platform_announcements and platform_announcement_views tables
--              for full-screen announcements/celebrations shown to all users
-- ============================================================

-- -----------------------------------------------------------
-- 1. platform_announcements
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.platform_announcements (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  title_en TEXT,
  message_en TEXT,
  type TEXT DEFAULT 'celebration' CHECK (type IN ('celebration', 'announcement', 'alert', 'maintenance')),
  image_url TEXT,
  bg_color TEXT DEFAULT 'from-sky-700 via-sky-800 to-teal-700',
  icon TEXT DEFAULT '🎉',
  display_location TEXT DEFAULT 'login' CHECK (display_location IN ('login', 'dashboard', 'everywhere')),
  display_size TEXT DEFAULT 'fullscreen' CHECK (display_size IN ('fullscreen', 'banner', 'popup')),
  start_at TIMESTAMPTZ DEFAULT now(),
  end_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT true NOT NULL,
  created_by UUID REFERENCES public.users(id),
  views_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_platform_announcements_active ON public.platform_announcements(is_active);
CREATE INDEX IF NOT EXISTS idx_platform_announcements_dates ON public.platform_announcements(start_at, end_at);
CREATE INDEX IF NOT EXISTS idx_platform_announcements_location ON public.platform_announcements(display_location);

-- Enable RLS
ALTER TABLE public.platform_announcements ENABLE ROW LEVEL SECURITY;

-- Anyone can read active announcements
CREATE POLICY "Anyone can view active platform announcements"
  ON public.platform_announcements FOR SELECT
  USING (is_active = true);

-- Admins can do everything
CREATE POLICY "Admins can manage platform announcements"
  ON public.platform_announcements FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = auth.uid()
      AND users.role IN ('admin', 'superadmin')
    )
  );

-- Auto-update updated_at trigger
CREATE OR REPLACE FUNCTION public.update_platform_announcements_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER platform_announcements_updated_at
  BEFORE UPDATE ON public.platform_announcements
  FOR EACH ROW
  EXECUTE FUNCTION public.update_platform_announcements_updated_at();

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.platform_announcements;

-- -----------------------------------------------------------
-- 2. platform_announcement_views
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.platform_announcement_views (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  announcement_id UUID NOT NULL REFERENCES public.platform_announcements(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.users(id),
  viewed_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_announcement_views_announcement ON public.platform_announcement_views(announcement_id);
CREATE INDEX IF NOT EXISTS idx_announcement_views_user ON public.platform_announcement_views(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_announcement_views_unique ON public.platform_announcement_views(announcement_id, user_id);

-- Enable RLS
ALTER TABLE public.platform_announcement_views ENABLE ROW LEVEL SECURITY;

-- Anyone can insert their own view
CREATE POLICY "Users can insert their own announcement views"
  ON public.platform_announcement_views FOR INSERT
  WITH CHECK (user_id = auth.uid() OR user_id IS NULL);

-- Anyone can read views
CREATE POLICY "Anyone can read announcement views"
  ON public.platform_announcement_views FOR SELECT
  USING (true);

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.platform_announcement_views;
