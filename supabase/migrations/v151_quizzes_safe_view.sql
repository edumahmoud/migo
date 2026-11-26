-- Student-facing quiz reads go through this view: same rows a linked student could read before,
-- but the answer key is removed (correctAnswer dropped, matching pairs mis-paired).
-- Additive: the base-table policy is dropped separately in v152 after the code is live.
CREATE OR REPLACE FUNCTION public.sanitize_quiz_questions(qs jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(jsonb_agg(
    CASE
      WHEN q.elem->>'type' = 'matching' AND jsonb_typeof(q.elem->'pairs') = 'array' AND jsonb_array_length(q.elem->'pairs') > 1 THEN
        (q.elem - 'correctAnswer') || jsonb_build_object('pairs', (
          SELECT jsonb_agg(jsonb_build_object('key', p.e->'key', 'value', (q.elem->'pairs'->((p.i)::int % jsonb_array_length(q.elem->'pairs')))->'value') ORDER BY p.i)
          FROM (SELECT e, (ord)::int AS i FROM jsonb_array_elements(q.elem->'pairs') WITH ORDINALITY AS t(e, ord)) p
        ))
      ELSE q.elem - 'correctAnswer'
    END ORDER BY q.ord), '[]'::jsonb)
  FROM jsonb_array_elements(CASE WHEN jsonb_typeof(qs) = 'array' THEN qs ELSE '[]'::jsonb END) WITH ORDINALITY AS q(elem, ord);
$$;

CREATE OR REPLACE VIEW public.quizzes_safe AS
SELECT (jsonb_populate_record(null::public.quizzes,
         to_jsonb(q) || jsonb_build_object('questions', public.sanitize_quiz_questions(q.questions)))).*
FROM public.quizzes q
WHERE q.user_id = auth.uid()
   OR q.user_id IN (SELECT l.teacher_id FROM public.teacher_student_links l WHERE l.student_id = auth.uid() AND l.status = 'approved');

GRANT SELECT ON public.quizzes_safe TO authenticated;
