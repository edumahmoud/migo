-- v141: version history for legal pages + one-place contact email. Additive only.
CREATE TABLE IF NOT EXISTS public.legal_document_versions (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug        TEXT NOT NULL,
  content_md  TEXT NOT NULL,
  saved_by    UUID,
  saved_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_legal_versions_slug CHECK (slug IN ('terms','refund','privacy'))
);
CREATE INDEX IF NOT EXISTS idx_legal_versions_slug_saved ON public.legal_document_versions (slug, saved_at DESC);

CREATE TABLE IF NOT EXISTS public.legal_settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_by  UUID,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_legal_settings_key CHECK (key IN ('contact_email'))
);

ALTER TABLE public.legal_document_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.legal_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.legal_document_versions FROM anon, authenticated;
REVOKE ALL ON public.legal_settings FROM anon, authenticated;
GRANT ALL ON public.legal_document_versions TO service_role;
GRANT ALL ON public.legal_settings TO service_role;

-- keep current text as version 1 so nothing is lost (no-op if table empty)
INSERT INTO public.legal_document_versions (slug, content_md, saved_by, saved_at)
SELECT slug, content_md, updated_by, updated_at FROM public.legal_documents;
