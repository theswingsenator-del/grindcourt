-- GrindCourt — Stage 9: Outcome Check-ins + Brief the Judge
-- Run AFTER 0001-0004. Safe to re-run (guards on if not exists / drop-if-exists
-- where Postgres doesn't support "if not exists" natively, e.g. constraints).

-- ── task_checkins ────────────────────────────────────────────────────────
-- A quick honest follow-up prompted when a task carrying an implicit
-- real-world outcome (revenue, a measurable result) is marked done — see
-- lib/checkin.ts looksOutcomeSensitive(). Most tasks never get a row here.
create table if not exists task_checkins (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  task_id uuid not null references tasks(id) on delete cascade,
  user_id uuid not null references app_users(id) on delete cascade,
  prompted_at timestamptz not null default now(),
  response_text text,
  responded_at timestamptz,
  ai_assessment text check (ai_assessment in ('on_track', 'short', 'unclear')),
  follow_up_created boolean not null default false
);

create index if not exists task_checkins_task_idx on task_checkins(task_id);
create index if not exists task_checkins_user_idx on task_checkins(user_id);

-- ── fine_briefs ──────────────────────────────────────────────────────────
-- A free-form narrative explanation submitted against ANY fine (unlike
-- Appeal, not gated to first offense) — the Judge reads it holistically and
-- may waive the fine outright, waive it and retroactively mark the related
-- task done, or insist the fine stands. See lib/judge.ts judgeBrief().
create table if not exists fine_briefs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  fine_id uuid not null references fines(id) on delete cascade,
  submitted_by uuid not null references app_users(id) on delete cascade,
  brief_text text not null,
  ai_verdict text check (ai_verdict in ('waive', 'update_task', 'insist')),
  ai_reasoning text,
  decided_at timestamptz
);

create index if not exists fine_briefs_fine_idx on fine_briefs(fine_id);

-- ── fines.status: add 'waived' ──────────────────────────────────────────
-- The inline check constraint from 0001_init.sql auto-named itself
-- "fines_status_check" (Postgres's default naming: <table>_<column>_check).
-- Verified against 0001_init.sql — it's the only check constraint on
-- fines.status, so this name is correct. Drop and recreate with the
-- expanded allowed-value list.
alter table fines drop constraint if exists fines_status_check;
alter table fines add constraint fines_status_check check (status in (
  'issued', 'bid_pending', 'accepted', 'appealed',
  'paid_pending_proof', 'paid_approved', 'appeal_denied', 'waived'
));

-- ── row level security ───────────────────────────────────────────────────
alter table task_checkins enable row level security;
alter table fine_briefs enable row level security;

drop policy if exists "authenticated read all" on task_checkins;
drop policy if exists "authenticated read all" on fine_briefs;
create policy "authenticated read all" on task_checkins for select to authenticated using (true);
create policy "authenticated read all" on fine_briefs for select to authenticated using (true);

-- ── realtime ─────────────────────────────────────────────────────────────
alter publication supabase_realtime add table task_checkins;
alter publication supabase_realtime add table fine_briefs;
