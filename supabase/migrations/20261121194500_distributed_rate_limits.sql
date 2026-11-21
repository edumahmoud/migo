-- Distributed rate limiting backed by Postgres (replaces the per-instance
-- in-memory Map, which resets on every Vercel cold start and is trivially
-- bypassed across instances).
--
-- Apply in the Supabase SQL editor or via `supabase db push`.

-- 1. Counter table. No RLS policies are added: with RLS enabled and no
--    policies, anon/authenticated get NO access. The service role bypasses
--    RLS, so only server-side code can read/write counters.
create table if not exists public.rate_limits (
  key       text        primary key,
  count     integer     not null default 0,
  reset_at  timestamptz not null
);

alter table public.rate_limits enable row level security;

-- 2. Atomic check-and-increment. One row per key; the window resets when it
--    expires. Runs as SECURITY DEFINER so the service role can update the
--    table; EXECUTE is revoked from everyone else below.
create or replace function public.check_rate_limit(
  p_key       text,
  p_max       integer,
  p_window_ms integer
)
returns table(allowed boolean, remaining integer, retry_after_ms integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now    timestamptz := now();
  v_window interval    := make_interval(secs => p_window_ms / 1000.0);
  v_count  integer;
  v_reset  timestamptz;
begin
  insert into public.rate_limits as rl (key, count, reset_at)
  values (p_key, 1, v_now + v_window)
  on conflict (key) do update
    set count    = case when v_now > rl.reset_at then 1 else rl.count + 1 end,
        reset_at = case when v_now > rl.reset_at then v_now + v_window else rl.reset_at end
  returning count, reset_at into v_count, v_reset;

  allowed        := v_count <= p_max;
  remaining      := greatest(0, p_max - v_count);
  retry_after_ms := case
                      when v_count <= p_max then 0
                      else greatest(0, floor(extract(epoch from (v_reset - v_now)) * 1000))::integer
                    end;
  return next;
end;
$$;

-- Functions are executable by PUBLIC by default — lock this one down.
-- Server code calls it through the service role, which owns all privileges.
revoke execute on function public.check_rate_limit(text, integer, integer) from public, anon, authenticated;

-- 3. Housekeeping: expired rows can be deleted lazily. Optional pg_cron job:
-- select cron.schedule('rate-limits-cleanup', '15 * * * *',
--   $$delete from public.rate_limits where reset_at < now() - interval '1 day'$$);
