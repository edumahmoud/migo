-- v155: complaints privacy + assignment hardening
create table if not exists public._bk_policies as select * from pg_policies where false;
insert into public._bk_policies select * from pg_policies where schemaname='public' and tablename in ('reports','report_responses','report_messages') and not exists (select 1 from public._bk_policies);
create table if not exists public._bk_fn (name text, def text, at timestamptz default now());
insert into public._bk_fn(name, def) select 'auto_assign_report', pg_get_functiondef(p.oid) from pg_proc p where proname='auto_assign_report' and not exists (select 1 from public._bk_fn where name='auto_assign_report');
create table if not exists public._bk_report_assign (id uuid, assigned_to uuid);

-- 1) the reported person is never the handler
create or replace function public.auto_assign_report() returns trigger language plpgsql security definer as $function$
declare v_reporter_role text; v_teacher_id uuid; v_supervisor_id uuid; v_reported uuid; v_reported_role text; v_assignee_role text;
begin
  select role into v_reporter_role from public.users where id = new.reporter_id;
  if v_reporter_role = 'student' then
    select tsl.teacher_id into v_teacher_id from public.teacher_student_links tsl where tsl.student_id = new.reporter_id and tsl.status = 'approved' order by tsl.created_at desc limit 1;
    if v_teacher_id is not null then new.assigned_to := v_teacher_id; new.status := 'pending'; end if;
  elsif v_reporter_role = 'teacher' then
    select tsl.supervisor_id into v_supervisor_id from public.teacher_supervisor_links tsl where tsl.teacher_id = new.reporter_id and tsl.is_primary = true limit 1;
    if v_supervisor_id is not null then new.assigned_to := v_supervisor_id; new.status := 'pending'; end if;
  elsif v_reporter_role in ('admin','superadmin') then
    select u.id into v_supervisor_id from public.users u where u.role = 'superadmin' order by u.created_at limit 1;
    if v_supervisor_id is not null then new.assigned_to := v_supervisor_id; new.status := 'pending'; end if;
  end if;
  -- who is the complaint about?
  if new.target_id is not null then
    if new.target_type = 'user' then v_reported := new.target_id;
    elsif new.target_type = 'comment' then select c.user_id into v_reported from public.video_comments c where c.id::text = new.target_id::text;
    elsif new.target_type = 'message' then select m.sender_id into v_reported from public.chat_messages m where m.id::text = new.target_id::text;
    end if;
  end if;
  if new.assigned_to is not null and v_reported is not null then
    select role into v_reported_role from public.users where id = v_reported;
    select role into v_assignee_role from public.users where id = new.assigned_to;
    if new.assigned_to = v_reported or (v_reported_role in ('admin','superadmin') and v_assignee_role = 'teacher') then
      new.assigned_to := null;  -- unassigned = handled by the admins
    end if;
  end if;
  return new;
end; $function$;

-- existing open complaints that are handled by the person they are about
insert into public._bk_report_assign select r.id, r.assigned_to from public.reports r where r.assigned_to is not null and (
  (r.target_type='user' and r.target_id = r.assigned_to)
  or (r.target_type='comment' and exists (select 1 from public.video_comments c where c.id::text=r.target_id::text and c.user_id = r.assigned_to))
  or (r.target_type='message' and exists (select 1 from public.chat_messages m where m.id::text=r.target_id::text and m.sender_id = r.assigned_to)));
update public.reports set assigned_to = null where id in (select id from public._bk_report_assign);

-- 2) direct database access: the reported person gets nothing; writes go through the API only
drop policy if exists "Users can view relevant reports" on public.reports;
create policy "Users can view relevant reports" on public.reports for select using (
  auth.uid() = reporter_id
  or (auth.uid() = assigned_to and not (target_type = 'user' and target_id = auth.uid()))
  or (exists (select 1 from public.users where id = auth.uid() and role in ('admin','superadmin')) and not (target_type = 'user' and target_id = auth.uid())));
drop policy if exists "Assigned users and admins can update reports" on public.reports;
drop policy if exists "Authenticated users can create reports" on public.reports;
drop policy if exists "Users can delete completed reports" on public.reports;

drop policy if exists "Users can view report responses" on public.report_responses;
create policy "Users can view report responses" on public.report_responses for select using (
  exists (select 1 from public.reports r where r.id = report_responses.report_id and (
    (r.reporter_id = auth.uid() and report_responses.action <> 'message_reported')
    or (r.assigned_to = auth.uid() and not (r.target_type = 'user' and r.target_id = auth.uid()))
    or (exists (select 1 from public.users where id = auth.uid() and role in ('admin','superadmin')) and not (r.target_type = 'user' and r.target_id = auth.uid())))));
drop policy if exists "Users can add report responses" on public.report_responses;

drop policy if exists "Users can view report messages" on public.report_messages;
create policy "Users can view report messages" on public.report_messages for select using (
  auth.uid() = recipient_id or auth.uid() = sender_id
  or exists (select 1 from public.reports r where r.id = report_messages.report_id and (
    (r.assigned_to = auth.uid() and not (r.target_type = 'user' and r.target_id = auth.uid()))
    or (exists (select 1 from public.users where id = auth.uid() and role in ('admin','superadmin')) and not (r.target_type = 'user' and r.target_id = auth.uid())))));
drop policy if exists "Assigned users and admins can send report messages" on public.report_messages;
