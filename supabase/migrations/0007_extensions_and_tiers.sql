-- GrindCourt — Stage 10: per-user enforcement launch times, tiered
-- lateness fines, and "Request more time" extension requests.
-- Run AFTER 0001-0006. Safe to re-run (guards on if not exists / drop-if-exists
-- where Postgres doesn't support "if not exists" natively, e.g. constraints).

-- ── app_users.enforcement_start_at ──────────────────────────────────────
-- Replaces the old single global ENFORCEMENT_START_AT env var, which gated
-- ALL enforcement for BOTH partners identically. Now that timezones are
-- per-user (0006_timezones.sql), Jason and Samuel are launching the
-- judicial system at their own local midnight — different UTC instants —
-- so the gate has to be per-user too. NULL means "not yet launched for
-- this person" and the app treats that as "never enforce" until this is
-- explicitly set. See lib/violations.ts isEnforcementLive().
alter table app_users add column if not exists enforcement_start_at timestamptz;

-- Mapping follows the same app_users.slot convention confirmed correct for
-- the 0006_timezones.sql migration: partner_a = Jason = Africa/Lagos,
-- partner_b = Samuel = America/Indiana/Indianapolis.
-- Jason: 12:00am Africa/Lagos (WAT, UTC+1 year-round) on 2026-08-07 = 2026-08-06T23:00:00Z.
update app_users set enforcement_start_at = '2026-08-06T23:00:00Z' where slot = 'partner_a';
-- Samuel: 12:00am America/Indiana/Indianapolis on 2026-08-07. Indianapolis
-- observes EDT (UTC-4) in August, so local midnight = 2026-08-07T04:00:00Z.
update app_users set enforcement_start_at = '2026-08-07T04:00:00Z' where slot = 'partner_b';

-- ── violations.type: add 'late_completion' ──────────────────────────────
-- The inline check constraint from 0001_init.sql auto-named itself
-- "violations_type_check" (Postgres's default naming: <table>_<column>_check).
-- Verified against 0001_init.sql — it's the only check constraint on
-- violations.type, and its original allowed-value list was exactly:
-- 'missed_log', 'task_overdue', 'false_complete', 'late_night_activity',
-- 'unbudgeted_rest', 'repeat_excuse', 'ignored_nags'. Drop and recreate
-- with 'late_completion' added, same drop/recreate approach used for
-- fines_status_check in 0005_checkins_and_briefs.sql.
alter table violations drop constraint if exists violations_type_check;
alter table violations add constraint violations_type_check check (type in (
  'missed_log', 'task_overdue', 'false_complete', 'late_night_activity',
  'unbudgeted_rest', 'repeat_excuse', 'ignored_nags', 'late_completion'
));

-- ── task_extension_requests ──────────────────────────────────────────────
-- "Request more time" — filed against a still-pending task's deadline
-- before its consequence lands. If the Judge grants it, tasks.due_at moves
-- to requested_due_at and no fine ever fires for the original deadline. If
-- denied, the original due date stands and normal fine logic (task_overdue
-- / late_completion) applies as usual. See lib/judge.ts
-- judgeExtensionRequest() and src/app/api/tasks/extend/route.ts.
create table if not exists task_extension_requests (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  task_id uuid not null references tasks(id) on delete cascade,
  requested_by uuid not null references app_users(id) on delete cascade,
  reason_text text not null,
  original_due_at timestamptz not null,
  requested_due_at timestamptz not null,
  ai_verdict text check (ai_verdict in ('granted', 'denied')),
  ai_reasoning text,
  decided_at timestamptz
);

create index if not exists task_extension_requests_task_idx on task_extension_requests(task_id);

-- ── row level security ───────────────────────────────────────────────────
alter table task_extension_requests enable row level security;

drop policy if exists "authenticated read all" on task_extension_requests;
create policy "authenticated read all" on task_extension_requests for select to authenticated using (true);

-- ── realtime ─────────────────────────────────────────────────────────────
alter publication supabase_realtime add table task_extension_requests;
