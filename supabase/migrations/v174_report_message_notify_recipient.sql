-- v174: a complaint message notifies the person it is addressed to (it used to notify the reporter or the handler only,
-- so the reported person never got a notification when a complaint was filed or when staff wrote to them).
create table if not exists public._bk_fn (name text, def text, at timestamptz default now());
insert into public._bk_fn(name, def) select 'notify_report_message', pg_get_functiondef(p.oid) from pg_proc p where proname='notify_report_message' and not exists (select 1 from public._bk_fn where name='notify_report_message');

create or replace function public.notify_report_message() returns trigger language plpgsql security definer as $function$
declare v_report record; v_recipient uuid; v_number text; v_title text; v_msg text;
begin
  select id, reporter_id, assigned_to, report_number into v_report from public.reports where id = new.report_id;
  if not found then return new; end if;
  v_number := v_report.report_number;
  v_recipient := new.recipient_id;
  if v_recipient is null or new.sender_id = v_recipient then return new; end if;
  if new.message_type = 'auto' then
    v_title := 'تم تقديم شكوى ضدك';
    v_msg := 'تم تقديم شكوى ضدك برقم ' || v_number || '. افتح الوارد للتفاصيل';
  elsif new.message_type = 'warning' then
    v_title := 'تحذير رسمي';
    v_msg := 'وصلك تحذير بخصوص الشكوى رقم ' || v_number;
  else
    v_title := 'رسالة جديدة على البلاغ';
    v_msg := 'لديك رسالة جديدة على البلاغ رقم ' || v_number;
  end if;
  insert into public.notifications (user_id, type, title, message, link) values (v_recipient, 'report', v_title, v_msg, '/reports/' || new.report_id);
  return new;
end; $function$;
