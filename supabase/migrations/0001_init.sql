-- ============================================================
-- Migration: 0001_init.sql
-- Full schema per PRD Section 2
-- ============================================================

-- ============================================================
-- 2.1 Enums
-- ============================================================
create type medication_form as enum ('tablet','capsule','liquid','injection','topical','inhaler','drop','other');
create type recurrence_type as enum ('daily','specific_days');
create type log_status as enum ('pending','taken','skipped','missed');
create type notification_channel as enum ('push','sms','email');
create type notification_status as enum ('sent','failed','mocked');

-- ============================================================
-- 2.2 profiles (1:1 extension of auth.users)
-- ============================================================
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  timezone text not null default 'UTC',
  push_subscription jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id);
create policy "profiles_insert_own" on public.profiles
  for insert with check (auth.uid() = id);

-- auto-create profile row on signup
create function public.handle_new_user() returns trigger as $$
begin
  insert into public.profiles (id, full_name) values (new.id, new.raw_user_meta_data->>'full_name');
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ============================================================
-- 2.3 medications
-- ============================================================
create table public.medications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  dose_amount numeric(10,2) not null check (dose_amount > 0),
  dose_unit text not null,               -- e.g. 'mg', 'ml', 'mcg', 'tablet(s)'
  form medication_form not null default 'tablet',
  instructions text,
  color_tag text not null default '#3b82f6', -- hex, UI badge color
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_medications_user_id on public.medications(user_id);

alter table public.medications enable row level security;

create policy "medications_all_own" on public.medications
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create function public.set_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

create trigger trg_medications_updated_at
  before update on public.medications
  for each row execute procedure public.set_updated_at();

-- ============================================================
-- 2.4 schedules
-- ============================================================
create table public.schedules (
  id uuid primary key default gen_random_uuid(),
  medication_id uuid not null references public.medications(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade, -- denormalized for RLS + query speed
  time_of_day time not null,             -- interpreted in profiles.timezone
  recurrence recurrence_type not null default 'daily',
  days_of_week smallint[] ,              -- 0=Sunday..6=Saturday; null when recurrence='daily'
  start_date date not null default current_date,
  end_date date,                          -- null = indefinite
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint chk_days_of_week check (
    (recurrence = 'daily' and days_of_week is null) or
    (recurrence = 'specific_days' and days_of_week is not null and days_of_week <@ array[0,1,2,3,4,5,6]::smallint[])
  )
);

create index idx_schedules_user_id on public.schedules(user_id);
create index idx_schedules_medication_id on public.schedules(medication_id);

alter table public.schedules enable row level security;

create policy "schedules_all_own" on public.schedules
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ============================================================
-- 2.5 medication_logs (one row per scheduled dose occurrence)
-- ============================================================
create table public.medication_logs (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid not null references public.schedules(id) on delete cascade,
  medication_id uuid not null references public.medications(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  scheduled_for timestamptz not null,     -- absolute UTC instant the dose is due
  status log_status not null default 'pending',
  taken_at timestamptz,
  notified_at timestamptz,                -- set once a notification has been dispatched
  created_at timestamptz not null default now(),
  unique (schedule_id, scheduled_for)      -- prevents duplicate generation for the same occurrence
);

create index idx_logs_user_status on public.medication_logs(user_id, status);
create index idx_logs_scheduled_for on public.medication_logs(scheduled_for);

alter table public.medication_logs enable row level security;

create policy "logs_select_own" on public.medication_logs
  for select using (auth.uid() = user_id);
create policy "logs_update_own" on public.medication_logs
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
-- INSERT is performed only by Edge Functions using the service role key (RLS bypassed)

-- ============================================================
-- 2.6 medication_explanations (shared OpenFDA cache, not user-scoped)
-- ============================================================
create table public.medication_explanations (
  id uuid primary key default gen_random_uuid(),
  query_key text not null unique,          -- lower(trim(medication_name))
  brand_name text,
  generic_name text,
  purpose text,
  warnings text,
  side_effects text[],
  source text not null,                    -- 'openfda' | 'fallback'
  raw_response jsonb,
  fetched_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index idx_explanations_query_key on public.medication_explanations(query_key);

alter table public.medication_explanations enable row level security;

create policy "explanations_select_authenticated" on public.medication_explanations
  for select using (auth.role() = 'authenticated');
-- No insert/update/delete policy for anon/authenticated; only the Edge Function (service role) writes to this table.

-- ============================================================
-- 2.7 notification_logs
-- ============================================================
create table public.notification_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  medication_log_id uuid not null references public.medication_logs(id) on delete cascade,
  channel notification_channel not null,
  payload jsonb not null,
  status notification_status not null,
  sent_at timestamptz not null default now()
);

create index idx_notification_logs_user_id on public.notification_logs(user_id);

alter table public.notification_logs enable row level security;

create policy "notification_logs_select_own" on public.notification_logs
  for select using (auth.uid() = user_id);
-- INSERT restricted to service role (Edge Functions); no policy granted to anon/authenticated.
