-- ============================================================
-- v62: Google OAuth Tokens Table
-- Stores Google provider tokens for Forms API access
-- Uses incremental authorization (no second login flow)
-- ============================================================

-- Table: google_oauth_tokens
-- Stores the Google OAuth access/refresh tokens per user
-- These are obtained via incremental authorization for the Forms API scope
CREATE TABLE IF NOT EXISTS public.google_oauth_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  token_expiry TIMESTAMPTZ NOT NULL,
  scope TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  -- Each user can only have one set of Google OAuth tokens
  UNIQUE(user_id)
);

-- Enable RLS
ALTER TABLE public.google_oauth_tokens ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only read/write their own tokens
CREATE POLICY "Users can view their own Google OAuth tokens"
  ON public.google_oauth_tokens
  FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert their own Google OAuth tokens"
  ON public.google_oauth_tokens
  FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update their own Google OAuth tokens"
  ON public.google_oauth_tokens
  FOR UPDATE
  USING (user_id = auth.uid());

-- Policy: Service role has full access (for API routes)
CREATE POLICY "Service role has full access to Google OAuth tokens"
  ON public.google_oauth_tokens
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Auto-update timestamp trigger
CREATE OR REPLACE FUNCTION public.update_google_oauth_tokens_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_google_oauth_tokens_updated_at ON public.google_oauth_tokens;
CREATE TRIGGER trigger_update_google_oauth_tokens_updated_at
  BEFORE UPDATE ON public.google_oauth_tokens
  FOR EACH ROW
  EXECUTE FUNCTION public.update_google_oauth_tokens_updated_at();
