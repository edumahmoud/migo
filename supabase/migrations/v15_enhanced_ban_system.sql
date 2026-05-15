-- Enhanced ban system: adds user_id, ban_until, banned_by, is_active columns
-- This allows temporary bans with duration, active/expired status tracking,
-- and linking bans to specific user records and admins.

-- Add new columns
ALTER TABLE public.banned_users ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES public.users(id) ON DELETE SET NULL;
ALTER TABLE public.banned_users ADD COLUMN IF NOT EXISTS ban_until TIMESTAMPTZ;
ALTER TABLE public.banned_users ADD COLUMN IF NOT EXISTS banned_by UUID REFERENCES public.users(id) ON DELETE SET NULL;
ALTER TABLE public.banned_users ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true NOT NULL;

-- Add indexes for efficient lookups
CREATE INDEX IF NOT EXISTS idx_banned_users_user_id ON public.banned_users(user_id);
CREATE INDEX IF NOT EXISTS idx_banned_users_is_active ON public.banned_users(is_active);
CREATE INDEX IF NOT EXISTS idx_banned_users_ban_until ON public.banned_users(ban_until);

-- Update existing records to be active (they were all active bans before this migration)
UPDATE public.banned_users SET is_active = true WHERE is_active IS NULL;
