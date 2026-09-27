-- ============================================================
-- Migration: 0004_inventory_and_duration.sql
-- Inventory tracking, treatment duration, and snooze support
-- ============================================================

-- 1. Add inventory and duration fields to medications
alter table public.medications
  add column if not exists tablets_remaining numeric(10,2) default null,
  add column if not exists tablets_per_dose numeric(10,2) not null default 1.0,
  add column if not exists refill_alert_days smallint not null default 3,
  add column if not exists duration_end_date date default null;

-- 2. Add snooze and nag fields to medication_logs
alter table public.medication_logs
  add column if not exists snoozed_until timestamptz default null;

-- 3. Trigger function to auto-decrement tablets when marked 'taken'
create or replace function public.handle_medication_taken_inventory()
returns trigger as $$
declare
  dose_units numeric(10,2);
begin
  -- Get the tablets_per_dose from parent medication
  select coalesce(tablets_per_dose, 1.0) into dose_units
  from public.medications
  where id = new.medication_id;

  -- If status transitioned from something else to 'taken'
  if (old.status != 'taken' and new.status = 'taken') then
    update public.medications
    set tablets_remaining = greatest(0, tablets_remaining - dose_units)
    where id = new.medication_id
      and tablets_remaining is not null;
  end if;

  -- If status transitioned from 'taken' back to something else (e.g. undo/rollback)
  if (old.status = 'taken' and new.status != 'taken') then
    update public.medications
    set tablets_remaining = tablets_remaining + dose_units
    where id = new.medication_id
      and tablets_remaining is not null;
  end if;

  return new;
end;
$$ language plpgsql security definer;

-- Drop existing trigger if any
drop trigger if exists trg_medication_taken_inventory on public.medication_logs;

create trigger trg_medication_taken_inventory
  after update on public.medication_logs
  for each row execute procedure public.handle_medication_taken_inventory();
