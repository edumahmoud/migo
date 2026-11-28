-- v176: link a reply to the message it answers, so the inbox can mark messages as replied
alter table public.report_messages add column if not exists reply_to_id uuid references public.report_messages(id) on delete set null;
create index if not exists idx_report_messages_reply_to on public.report_messages(reply_to_id);
