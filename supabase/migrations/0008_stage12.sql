-- GrindCourt — Stage 12: Talk to the Judge, streaks (computed live, no
-- schema), $3K sprint earnings tracking, per-user timezone reset label
-- (computed live, no schema), real task dependencies, push delivery
-- verification, fine explainer (reads existing data, no schema), fine
-- history on avatar tap (reads existing data, no schema).
-- Run AFTER 0001-0007. Safe to re-run.

-- ── judge_chat_messages ──────────────────────────────────────────────────
-- "Talk to the Judge" conversational task editor. Private per user — each
-- partner only ever queries their own rows (see src/app/talk/page.tsx and
-- src/lib/judgeChat.ts). RLS still follows the shared-board "authenticated
-- read all" convention used everywhere else in this app; privacy is
-- enforced at the query layer, same as notifications already are.
create table if not exists judge_chat_messages (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid not null references app_users(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  action_json jsonb
);

create index if not exists judge_chat_messages_user_idx on judge_chat_messages(user_id, created_at);

-- ── earnings_log ─────────────────────────────────────────────────────────
-- Feature 3: live $ progress toward the sprint goal. task_id is nullable —
-- an earning doesn't have to be tied to a specific task.
create table if not exists earnings_log (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid not null references app_users(id) on delete cascade,
  task_id uuid references tasks(id) on delete set null,
  amount_usd numeric not null check (amount_usd > 0),
  note text,
  logged_at timestamptz not null default now()
);

create index if not exists earnings_log_user_idx on earnings_log(user_id);
create index if not exists earnings_log_logged_at_idx on earnings_log(logged_at);

-- ── sprint_goal ──────────────────────────────────────────────────────────
-- Tiny singleton table — always queried with `limit 1`, no enforced
-- single-row constraint (kept simple, matches the rest of the schema's
-- style of trusting the app layer rather than adding a DB-level singleton
-- guard for a table with exactly one seeded row).
create table if not exists sprint_goal (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  target_usd numeric not null,
  label text not null,
  starts_at date not null,
  ends_at date not null
);

insert into sprint_goal (target_usd, label, starts_at, ends_at)
select 3000, '10-Day $3K Sprint', current_date, current_date + interval '10 days'
where not exists (select 1 from sprint_goal);

-- ── tasks.blocked_by_task_id ─────────────────────────────────────────────
-- Feature 5: real task-dependency system. A task is "blocked" while the
-- referenced task isn't done yet — checked at render/detection time, no
-- extra "is currently blocked" flag needed (see task/[id]/page.tsx and
-- lib/violations.ts detectOverdueTasks).
alter table tasks add column if not exists blocked_by_task_id uuid references tasks(id) on delete set null;

create index if not exists tasks_blocked_by_idx on tasks(blocked_by_task_id);

-- ── notifications push delivery counts ──────────────────────────────────
-- Feature 6: persist what sendPushToUser() actually returned so delivery
-- can be verified after the fact instead of trusted blindly.
alter table notifications add column if not exists push_sent_count integer not null default 0;
alter table notifications add column if not exists push_pruned_count integer not null default 0;

-- ── row level security ───────────────────────────────────────────────────
alter table judge_chat_messages enable row level security;
alter table earnings_log enable row level security;
alter table sprint_goal enable row level security;

drop policy if exists "authenticated read all" on judge_chat_messages;
create policy "authenticated read all" on judge_chat_messages for select to authenticated using (true);

drop policy if exists "authenticated read all" on earnings_log;
create policy "authenticated read all" on earnings_log for select to authenticated using (true);

drop policy if exists "authenticated read all" on sprint_goal;
create policy "authenticated read all" on sprint_goal for select to authenticated using (true);

-- ── realtime ─────────────────────────────────────────────────────────────
alter publication supabase_realtime add table judge_chat_messages;
alter publication supabase_realtime add table earnings_log;
alter publication supabase_realtime add table sprint_goal;
