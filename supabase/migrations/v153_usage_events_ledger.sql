-- Usage ledger: one row per created summary / AI quiz from a summary / AI bank question / quiz attempt.
-- AI bank questions are logged by the app (/api/question-bank PUT with aiGenerated) because bank_questions has no owner column.
-- Rows are never deleted when the item is deleted, so deleting does not free a usage slot.
CREATE TABLE IF NOT EXISTS public.usage_events (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  source     TEXT NOT NULL CHECK (source IN ('summary','summary_quiz','ai_question','quiz_attempt')),
  item_id    UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_usage_events_user_source_time ON public.usage_events(user_id, source, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_usage_events_item ON public.usage_events(source, item_id) WHERE item_id IS NOT NULL;
ALTER TABLE public.usage_events ENABLE ROW LEVEL SECURITY; -- no policies: service role only

CREATE OR REPLACE FUNCTION public.log_usage_summary() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.usage_events(user_id, source, item_id, created_at) VALUES (NEW.user_id, 'summary', NEW.id, COALESCE(NEW.created_at, now())) ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION public.log_usage_quiz() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.summary_id IS NOT NULL THEN
    INSERT INTO public.usage_events(user_id, source, item_id, created_at) VALUES (NEW.user_id, 'summary_quiz', NEW.id, COALESCE(NEW.created_at, now())) ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION public.log_usage_score() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.usage_events(user_id, source, item_id, created_at) VALUES (NEW.student_id, 'quiz_attempt', NEW.id, COALESCE(NEW.completed_at, now())) ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_usage_summary ON public.summaries;
CREATE TRIGGER trg_usage_summary AFTER INSERT ON public.summaries FOR EACH ROW EXECUTE FUNCTION public.log_usage_summary();
DROP TRIGGER IF EXISTS trg_usage_quiz ON public.quizzes;
CREATE TRIGGER trg_usage_quiz AFTER INSERT ON public.quizzes FOR EACH ROW EXECUTE FUNCTION public.log_usage_quiz();
DROP TRIGGER IF EXISTS trg_usage_score ON public.scores;
CREATE TRIGGER trg_usage_score AFTER INSERT ON public.scores FOR EACH ROW EXECUTE FUNCTION public.log_usage_score();

-- Backfill from items that still exist (items deleted before this point are not recoverable).
INSERT INTO public.usage_events(user_id, source, item_id, created_at) SELECT user_id, 'summary', id, created_at FROM public.summaries ON CONFLICT DO NOTHING;
INSERT INTO public.usage_events(user_id, source, item_id, created_at) SELECT user_id, 'summary_quiz', id, created_at FROM public.quizzes WHERE summary_id IS NOT NULL ON CONFLICT DO NOTHING;
INSERT INTO public.usage_events(user_id, source, item_id, created_at) SELECT student_id, 'quiz_attempt', id, completed_at FROM public.scores WHERE student_id IS NOT NULL ON CONFLICT DO NOTHING;
