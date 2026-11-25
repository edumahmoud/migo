-- Keep the pg_cron run log small: the quiz job writes one row per minute.
-- Daily at 01:00 UTC delete log rows older than 2 days.
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'cron-log-cleanup';
SELECT cron.schedule('cron-log-cleanup', '0 1 * * *', $$delete from cron.job_run_details where end_time < now() - interval '2 days'$$);
