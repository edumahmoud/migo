drop index if exists public.idx_report_messages_reply_to;
alter table public.report_messages drop column if exists reply_to_id;
