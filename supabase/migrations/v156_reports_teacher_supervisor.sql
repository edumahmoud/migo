-- v156: complaints against a teacher go to the supervisor linked to that teacher
create table if not exists public._bk_report_assign2 (id uuid, assigned_to uuid, at timestamptz default now());

create or replace function public.report_handler_for_teacher(p_teacher uuid) returns uuid language sql stable security definer as $$
  select coalesce(
    (select l.supervisor_id from public.teacher_supervisor_links l where l.teacher_id = p_teacher and l.supervisor_id <> p_teacher order by l.is_primary desc, l.created_at asc limit 1),
    (select u.id from public.users u where u.role = 'superadmin' and u.id <> p_teacher order by u.created_at asc limit 1)
  );
$$;

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
  if new.target_id is not null then
    if new.target_type = 'user' then v_reported := new.target_id;
    elsif new.target_type = 'comment' then select c.user_id into v_reported from public.video_comments c where c.id::text = new.target_id::text;
    elsif new.target_type = 'message' then select m.sender_id into v_reported from public.chat_messages m where m.id::text = new.target_id::text;
    end if;
  end if;
  if v_reported is not null then
    select role into v_reported_role from public.users where id = v_reported;
    if v_reported_role = 'teacher' then
      -- a complaint about a teacher is handled by the supervisor linked to that teacher
      -- (the platform owner only when the teacher has no linked supervisor)
      new.assigned_to := public.report_handler_for_teacher(v_reported); new.status := 'pending';
    end if;
    if new.assigned_to is not null then
      select role into v_assignee_role from public.users where id = new.assigned_to;
      if new.assigned_to = v_reported or (v_reported_role in ('admin','superadmin') and v_assignee_role = 'teacher') then
        new.assigned_to := null;
      end if;
    end if;
  end if;
  return new;
end; $function$;

-- open complaints about a teacher: move to that teacher's supervisor
insert into public._bk_report_assign2 (id, assigned_to)
select r.id, r.assigned_to from public.reports r join public.users u on u.id = r.target_id and r.target_type = 'user' and u.role = 'teacher'
where r.status in ('pending','in_progress');
update public.reports r set assigned_to = public.report_handler_for_teacher(r.target_id)
where r.id in (select id from public._bk_report_assign2);

-- admin (non-owner) sees complaints assigned to them or unassigned; the owner sees all
drop policy if exists "Users can view relevant reports" on public.reports;
create policy "Users can view relevant reports" on public.reports for select using (
  auth.uid() = reporter_id
  or (auth.uid() = assigned_to and not (target_type = 'user' and target_id = auth.uid()))
  or (not (target_type = 'user' and target_id = auth.uid()) and exists (select 1 from public.users u where u.id = auth.uid() and (u.role = 'superadmin' or (u.role = 'admin' and (reports.assigned_to is null or reports.assigned_to = auth.uid()))))));
