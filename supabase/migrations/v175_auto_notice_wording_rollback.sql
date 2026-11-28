do $$ declare d text; begin
  select def into d from public._bk_fn where name='auto_notify_reported_user' order by at asc limit 1;
  if d is not null then execute d; end if;
end $$;
