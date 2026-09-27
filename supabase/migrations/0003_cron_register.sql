-- Register pg_cron job for check-pending-notifications
-- Migration 0003: cron job registration

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Remove existing job if present (idempotent)
select cron.unschedule('check-pending-notifications-job') where exists (
  select 1 from cron.job where jobname = 'check-pending-notifications-job'
);

select cron.schedule(
  'check-pending-notifications-job',
  '* * * * *',
  $cron$
  select net.http_post(
    url := 'https://qrkovpbomzwwxftjlxjg.supabase.co/functions/v1/check-pending-notifications',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFya292cGJvbXp3d3hmdGpseGpnIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc5MDUwMTQ1NSwiZXhwIjoyMTA2MDc3NDU1fQ.X_477J4P8w4MnHIGDMmq9Bgy5e8aBmGNwF21j4tTR7M',
      'x-cron-secret', 'cron-med-103824-secret'
    ),
    body := '{}'::jsonb
  );
  $cron$
);
