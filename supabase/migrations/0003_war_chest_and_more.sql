-- GrindCourt — schema v2 additions (Stages 2-7)
-- Adds: War Chest (treasury), collaborative work orders, Predictor, Auditor,
-- Narrator, and Board Conduct settings. Run AFTER 0001_init.sql and
-- 0002_seed_users_template.sql. Safe to re-run (create if not exists / on
-- conflict do nothing throughout).
--
-- Same access model as 0001: RLS on everywhere, authenticated read-all,
-- zero client-side write policies — every write goes through a Next.js API
-- route using the service-role key.

-- ── war_chest_projects ──────────────────────────────────────────────────
-- Line items the fine treasury can fund. Seeded rows are the starting
-- wishlist; 'ai_suggested' rows can be added later by the Board.
create table if not exists war_chest_projects (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text not null,
  cost_naira numeric not null check (cost_naira > 0),
  status text not null default 'seeded' check (status in ('seeded', 'proposed', 'funded')),
  source text not null default 'seeded' check (source in ('seeded', 'ai_suggested'))
);

-- ── war_chest_proposals ──────────────────────────────────────────────────
-- The Board proposes ONE active project at a time. Only one row per
-- project_id should ever be 'active' at once (enforced in lib/treasury.ts,
-- not at the DB level, so superseding stays a simple insert+update).
create table if not exists war_chest_proposals (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  project_id uuid not null references war_chest_projects(id) on delete cascade,
  ai_reasoning text,
  status text not null default 'active' check (status in ('active', 'accepted', 'superseded'))
);

create index if not exists war_chest_proposals_project_idx on war_chest_proposals(project_id);
create index if not exists war_chest_proposals_status_idx on war_chest_proposals(status);

-- ── war_chest_pleas ──────────────────────────────────────────────────────
-- Either partner can plead for a different priority than the Board's
-- current active proposal. The Board's response is stored inline.
create table if not exists war_chest_pleas (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  proposal_id uuid not null references war_chest_proposals(id) on delete cascade,
  submitted_by uuid not null references app_users(id) on delete cascade,
  reason_text text not null,
  ai_response text
);

create index if not exists war_chest_pleas_proposal_idx on war_chest_pleas(proposal_id);

-- ── task_collaborators ───────────────────────────────────────────────────
-- A partner requesting to join (or already approved on) someone else's
-- work order. Joining means an even split of credit for that task.
create table if not exists task_collaborators (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  task_id uuid not null references tasks(id) on delete cascade,
  user_id uuid not null references app_users(id) on delete cascade,
  status text not null default 'requested' check (status in ('requested', 'approved')),
  unique (task_id, user_id)
);

create index if not exists task_collaborators_task_idx on task_collaborators(task_id);
create index if not exists task_collaborators_user_idx on task_collaborators(user_id);

-- ── task_notes ───────────────────────────────────────────────────────────
-- Progress-note thread on a task, visible to the owner + approved
-- collaborators.
create table if not exists task_notes (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  task_id uuid not null references tasks(id) on delete cascade,
  user_id uuid not null references app_users(id) on delete cascade,
  body text not null
);

create index if not exists task_notes_task_idx on task_notes(task_id);

-- tasks: "need help" flag, distinct from an unprompted join-request.
alter table tasks add column if not exists needs_help boolean not null default false;

-- ── predictor_nudges ─────────────────────────────────────────────────────
-- Pre-emptive AI nudges based on a user's OWN missed-check-in pattern by
-- day-of-week. Ignoring a nudge (no ack, and a violation follows the same
-- day) forfeits appeal eligibility on that violation — see
-- resulted_in_violation_id, wired in lib/issueFine.ts.
create table if not exists predictor_nudges (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid not null references app_users(id) on delete cascade,
  day_of_week int not null check (day_of_week between 0 and 6),
  message text not null,
  acknowledged boolean not null default false,
  resulted_in_violation_id uuid references violations(id) on delete set null
);

create index if not exists predictor_nudges_user_idx on predictor_nudges(user_id);

-- violations: forfeits appeal eligibility when the violation followed an
-- ignored Predictor nudge from the same day.
alter table violations add column if not exists appeal_forfeited boolean not null default false;

-- ── auditor_baseline ─────────────────────────────────────────────────────
-- Per-user rolling baseline of completed-task title length, used ONLY to
-- compare a user against their own history — never against their partner.
create table if not exists auditor_baseline (
  user_id uuid primary key references app_users(id) on delete cascade,
  avg_title_length numeric not null default 0,
  sample_size int not null default 0,
  updated_at timestamptz not null default now()
);

-- ── auditor_flags ────────────────────────────────────────────────────────
-- Silent, log-only anti-gaming flags. No user-facing consequence yet —
-- purely for future review. Never surfaced as an accusation in the UI.
create table if not exists auditor_flags (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid not null references app_users(id) on delete cascade,
  task_id uuid references tasks(id) on delete set null,
  note text
);

create index if not exists auditor_flags_user_idx on auditor_flags(user_id);

-- ── founders_updates ─────────────────────────────────────────────────────
-- The Narrator's weekly recap, one row per week.
create table if not exists founders_updates (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  week_start date not null,
  body text not null,
  unique (week_start)
);

-- ── conduct_settings ─────────────────────────────────────────────────────
-- Per-person Board Conduct preferences (Stage 7).
create table if not exists conduct_settings (
  user_id uuid primary key references app_users(id) on delete cascade,
  nag_tone text not null default 'blunt' check (nag_tone in ('blunt', 'roast', 'formal')),
  predictor_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

-- ── row level security ───────────────────────────────────────────────────
alter table war_chest_projects enable row level security;
alter table war_chest_proposals enable row level security;
alter table war_chest_pleas enable row level security;
alter table task_collaborators enable row level security;
alter table task_notes enable row level security;
alter table predictor_nudges enable row level security;
alter table auditor_baseline enable row level security;
alter table auditor_flags enable row level security;
alter table founders_updates enable row level security;
alter table conduct_settings enable row level security;

create policy "authenticated read all" on war_chest_projects for select to authenticated using (true);
create policy "authenticated read all" on war_chest_proposals for select to authenticated using (true);
create policy "authenticated read all" on war_chest_pleas for select to authenticated using (true);
create policy "authenticated read all" on task_collaborators for select to authenticated using (true);
create policy "authenticated read all" on task_notes for select to authenticated using (true);
create policy "authenticated read all" on predictor_nudges for select to authenticated using (true);
create policy "authenticated read all" on auditor_baseline for select to authenticated using (true);
create policy "authenticated read all" on auditor_flags for select to authenticated using (true);
create policy "authenticated read all" on founders_updates for select to authenticated using (true);
create policy "authenticated read all" on conduct_settings for select to authenticated using (true);

-- ── realtime ─────────────────────────────────────────────────────────────
alter publication supabase_realtime add table war_chest_projects;
alter publication supabase_realtime add table war_chest_proposals;
alter publication supabase_realtime add table war_chest_pleas;
alter publication supabase_realtime add table task_collaborators;
alter publication supabase_realtime add table task_notes;
alter publication supabase_realtime add table predictor_nudges;
alter publication supabase_realtime add table auditor_baseline;
alter publication supabase_realtime add table auditor_flags;
alter publication supabase_realtime add table founders_updates;
alter publication supabase_realtime add table conduct_settings;

-- ── seed: initial War Chest wishlist ────────────────────────────────────
insert into war_chest_projects (name, cost_naira, status, source) values
  ('Ads Spend', 40000, 'seeded', 'seeded'),
  ('Claude Pro — annual', 300000, 'seeded', 'seeded'),
  ('VPS subscription', 55000, 'seeded', 'seeded')
on conflict do nothing;
