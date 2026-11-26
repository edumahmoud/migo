-- v156: allow a manual storage upgrade with a custom size (no catalogue plan).
ALTER TABLE public.user_storage_upgrades ALTER COLUMN plan_id DROP NOT NULL;
NOTIFY pgrst, 'reload schema';
