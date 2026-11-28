-- Rollback v174: restore the saved previous function body.
do $$ declare d text; begin
  select def into d from public._bk_fn where name='notify_report_message' order by at asc limit 1;
  if d is not null then execute d; end if;
end $$;
