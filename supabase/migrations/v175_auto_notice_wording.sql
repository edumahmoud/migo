-- v175: the automatic notice to the reported person is clearly addressed to them and says what they can do.
create table if not exists public._bk_fn (name text, def text, at timestamptz default now());
insert into public._bk_fn(name, def) select 'auto_notify_reported_user', pg_get_functiondef(p.oid) from pg_proc p where proname='auto_notify_reported_user' and not exists (select 1 from public._bk_fn where name='auto_notify_reported_user');

create or replace function public.auto_notify_reported_user() returns trigger language plpgsql security definer as $function$
declare v_reported uuid; v_subject text; v_num text; v_reason text; v_type text; v_preview text; v_body text;
begin
  if TG_OP <> 'INSERT' then return new; end if;
  if new.target_type = 'user' and new.target_id is not null then
    v_reported := new.target_id;
  elsif new.target_type = 'comment' and new.target_id is not null then
    select vc.user_id, left(vc.content, 80) into v_reported, v_preview from public.video_comments vc where vc.id = new.target_id;
    if v_reported is not null then
      select s.name into v_subject from public.video_comments vc join public.subject_videos sv on sv.id = vc.video_id join public.subjects s on s.id = sv.subject_id where vc.id = new.target_id;
    end if;
  elsif new.target_type = 'message' and new.target_id is not null then
    select cm.sender_id, left(cm.content, 80) into v_reported, v_preview from public.chat_messages cm where cm.id = new.target_id;
  end if;
  if v_reported is null or v_reported = new.reporter_id then return new; end if;
  v_reason := case new.reason when 'inappropriate' then 'محتوى غير مناسب' when 'harassment' then 'تحرش أو تنمر' when 'spam' then 'رسائل مزعجة' when 'misinformation' then 'معلومات مضللة' when 'cheating' then 'غش أكاديمي' when 'inappropriateContent' then 'محتوى غير لائق' when 'impersonation' then 'حساب مزيف / انتحال شخصية' else 'سبب آخر' end;
  v_type := case new.target_type when 'comment' then 'تعليق' when 'message' then 'رسالة' when 'user' then 'حسابك' else 'أخرى' end;
  v_num := coalesce(new.report_number, new.id::text);
  v_body := 'إشعار إلى المشكو منه: تم تقديم شكوى ضدك' || E'\n'
    || 'رقم الشكوى: ' || v_num || E'\n'
    || 'سبب الشكوى: ' || v_reason || E'\n'
    || 'الشكوى بخصوص: ' || v_type;
  if v_subject is not null then v_body := v_body || E'\n' || 'المقرر: ' || v_subject; end if;
  if v_preview is not null then v_body := v_body || E'\n' || 'المحتوى المبلغ عنه: "' || v_preview || case when length(v_preview) >= 80 then '...' else '' end || '"'; end if;
  v_body := v_body || E'\n' || 'ماذا يمكنك أن تفعل: افتح تبويب "شكاوى ضدك" لمتابعة الإجراءات وتقديم اعتراض واحد، ويمكنك الرد على هذه الرسالة وسيصل ردك للمشرف المسؤول.' || E'\n' || 'هذه الرسالة موجهة إليك أنت فقط ولا تظهر لأي طرف آخر.';
  insert into public.report_messages (report_id, sender_id, recipient_type, recipient_id, content, message_type) values (new.id, new.reporter_id, 'reported', v_reported, v_body, 'auto');
  return new;
end; $function$;
