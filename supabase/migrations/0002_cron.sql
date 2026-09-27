-- ============================================================
-- Migration: 0002_cron.sql
-- Register pg_cron job for check-pending-notifications
-- PRD Section 3.2
-- ============================================================

-- Enable required extensions
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Register the cron job (runs every minute)
-- NOTE: Replace <CRON_EDGE_FUNCTION_URL> and <SUPABASE_SERVICE_ROLE_KEY> and <SHARED_SECRET>
-- with your actual values before running this migration.
-- These are set via environment variables in production.

select cron.schedule(
  'check-pending-notifications-job',
  '* * * * *',
  $$
  select net.http_post(
    url := current_setting('app.cron_edge_function_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', current_setting('app.cron_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);
