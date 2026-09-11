-- GrindCourt — schema v1
-- Two fixed partner accounts, real-money fine enforcement.
-- Run the whole file in the Supabase SQL Editor (or `supabase db push`). Safe to re-run.
--
-- Access model: RLS is ON everywhere. Authenticated users (the two partners) may
-- SELECT every row in every app table — this is a shared accountability app, both
-- partners must see the whole board live. ALL writes go through Next.js API routes
-- using the service-role key (never the anon key), so fine/ladder/violation logic
-- is always enforced server-side and can never be bypassed from the client.

create extension if not exists pgcrypto;

-- ── users ────────────────────────────────────────────────────────────────
-- Mirrors auth.users for the exactly-two partner accounts. Created by a
-- one-time seed after the two accounts are made in Supabase Auth (see README).
create table if not exists app_users (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  slot text not null unique check (slot in ('partner_a', 'partner_b')),
  created_at timestamptz not null default now()
);

-- ── goals ────────────────────────────────────────────────────────────────
create table if not exists goals (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  owner_id uuid not null references app_users(id) on delete cascade,
  title text not null,
  description text,
  target_date date
);

-- ── tasks ────────────────────────────────────────────────────────────────
create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  goal_id uuid references goals(id) on delete set null,
  owner_id uuid not null references app_users(id) on delete cascade,
  title text not null,
  description text,
  due_at timestamptz,
  status text not null default 'pending' check (status in ('pending', 'done', 'overdue')),
  completed_at timestamptz,
  is_disputed boolean not null default false,
  disputed_by uuid references app_users(id),
  dispute_resolved boolean not null default false
);

create index if not exists tasks_owner_idx on tasks(owner_id);
create index if not exists tasks_goal_idx on tasks(goal_id);
create index if not exists tasks_status_due_idx on tasks(status, due_at);

-- ── daily_logs ───────────────────────────────────────────────────────────
-- One row per user per calendar day — did they check in (morning commit
-- and/or night report) that day.
create table if not exists daily_logs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  owner_id uuid not null references app_users(id) on delete cascade,
  log_date date not null default current_date,
  morning_commit_done boolean not null default false,
  morning_commit_text text,
  morning_commit_at timestamptz,
  night_report_done boolean not null default false,
  night_report_text text,
  night_report_at timestamptz,
  unique (owner_id, log_date)
);

create index if not exists daily_logs_owner_date_idx on daily_logs(owner_id, log_date);

-- ── rest_days ────────────────────────────────────────────────────────────
-- Ledger of earn/spend events. Running balance = sum(delta) per user.
-- Earn rule: +1 rest day per 5 tasks completed (see lib/restDays.ts).
create table if not exists rest_days (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  owner_id uuid not null references app_users(id) on delete cascade,
  kind text not null check (kind in ('earned', 'spent')),
  delta int not null,
  reason text not null,
  related_task_id uuid references tasks(id) on delete set null
);

create index if not exists rest_days_owner_idx on rest_days(owner_id);

-- ── violations ───────────────────────────────────────────────────────────
create table if not exists violations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  type text not null check (type in (
    'missed_log', 'task_overdue', 'false_complete', 'late_night_activity',
    'unbudgeted_rest', 'repeat_excuse', 'ignored_nags'
  )),
  user_id uuid not null references app_users(id) on delete cascade,
  task_id uuid references tasks(id) on delete set null,
  detected_at timestamptz not null default now(),
  severity text not null default 'standard' check (severity in ('low', 'standard', 'high')),
  streak_count_at_time int not null default 1,
  details text
);

create index if not exists violations_user_type_idx on violations(user_id, type);
create index if not exists violations_task_idx on violations(task_id);

-- ── fines ────────────────────────────────────────────────────────────────
create table if not exists fines (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  violation_id uuid not null references violations(id) on delete cascade,
  user_id uuid not null references app_users(id) on delete cascade,
  amount numeric not null check (amount > 0),
  rung int not null check (rung >= 1),
  status text not null default 'issued' check (status in (
    'issued', 'bid_pending', 'accepted', 'appealed',
    'paid_pending_proof', 'paid_approved', 'appeal_denied'
  ))
);

create index if not exists fines_violation_idx on fines(violation_id);
create index if not exists fines_user_status_idx on fines(user_id, status);

-- ── bids ─────────────────────────────────────────────────────────────────
-- A bid is a user's counter-offer against an issued fine, judged by the AI.
create table if not exists bids (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  fine_id uuid not null references fines(id) on delete cascade,
  proposed_amount numeric not null check (proposed_amount > 0),
  reason_text text not null,
  submitted_by uuid not null references app_users(id) on delete cascade,
  ai_evaluation text,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected', 'countered')),
  counter_amount numeric
);

create index if not exists bids_fine_idx on bids(fine_id);

-- ── appeals ──────────────────────────────────────────────────────────────
-- Only allowed on a user's FIRST offense of a violation type (enforced in
-- lib/appeals.ts by checking violations history before insert).
create table if not exists appeals (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  fine_id uuid not null references fines(id) on delete cascade,
  reason_text text not null,
  ai_verdict text check (ai_verdict in ('approved', 'denied')),
  ai_reasoning text,
  decided_at timestamptz
);

create index if not exists appeals_fine_idx on appeals(fine_id);

-- ── payment_proofs ───────────────────────────────────────────────────────
create table if not exists payment_proofs (
  id uuid primary key default gen_random_uuid(),
  fine_id uuid not null references fines(id) on delete cascade,
  uploaded_by uuid not null references app_users(id) on delete cascade,
  image_url text not null,
  uploaded_at timestamptz not null default now(),
  approved_by_partner boolean not null default false,
  approved_at timestamptz
);

create index if not exists payment_proofs_fine_idx on payment_proofs(fine_id);

-- ── notifications ────────────────────────────────────────────────────────
create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid not null references app_users(id) on delete cascade,
  type text not null,
  title text not null,
  body text not null,
  read boolean not null default false,
  related_fine_id uuid references fines(id) on delete set null,
  related_task_id uuid references tasks(id) on delete set null
);

create index if not exists notifications_user_read_idx on notifications(user_id, read);

-- ── push_subscriptions ───────────────────────────────────────────────────
create table if not exists push_subscriptions (
  endpoint text primary key,
  created_at timestamptz not null default now(),
  user_id uuid not null references app_users(id) on delete cascade,
  p256dh text not null,
  auth text not null,
  user_agent text
);

create index if not exists push_subscriptions_user_idx on push_subscriptions(user_id);

-- ── row level security ───────────────────────────────────────────────────
-- Every table: any authenticated partner may read everything (shared board).
-- No client-side INSERT/UPDATE/DELETE policies are defined — all writes go
-- through API routes using the service-role key, which bypasses RLS by design.
alter table app_users enable row level security;
alter table goals enable row level security;
alter table tasks enable row level security;
alter table daily_logs enable row level security;
alter table rest_days enable row level security;
alter table violations enable row level security;
alter table fines enable row level security;
alter table bids enable row level security;
alter table appeals enable row level security;
alter table payment_proofs enable row level security;
alter table notifications enable row level security;
alter table push_subscriptions enable row level security;

create policy "authenticated read all" on app_users for select to authenticated using (true);
create policy "authenticated read all" on goals for select to authenticated using (true);
create policy "authenticated read all" on tasks for select to authenticated using (true);
create policy "authenticated read all" on daily_logs for select to authenticated using (true);
create policy "authenticated read all" on rest_days for select to authenticated using (true);
create policy "authenticated read all" on violations for select to authenticated using (true);
create policy "authenticated read all" on fines for select to authenticated using (true);
create policy "authenticated read all" on bids for select to authenticated using (true);
create policy "authenticated read all" on appeals for select to authenticated using (true);
create policy "authenticated read all" on payment_proofs for select to authenticated using (true);
create policy "authenticated read all" on notifications for select to authenticated using (true);

-- ── realtime ─────────────────────────────────────────────────────────────
alter publication supabase_realtime add table tasks;
alter publication supabase_realtime add table goals;
alter publication supabase_realtime add table daily_logs;
alter publication supabase_realtime add table violations;
alter publication supabase_realtime add table fines;
alter publication supabase_realtime add table bids;
alter publication supabase_realtime add table appeals;
alter publication supabase_realtime add table payment_proofs;
alter publication supabase_realtime add table notifications;

-- ── storage ──────────────────────────────────────────────────────────────
-- Bucket for payment proof screenshots. Created here so the migration is
-- one-stop; also documented in README in case the SQL Editor run skips
-- storage extension ownership on some project tiers (rare, but has bitten
-- us before — re-run `select storage.create_bucket(...)` manually if this
-- insert 0-rows silently).
insert into storage.buckets (id, name, public)
values ('payment-proofs', 'payment-proofs', false)
on conflict (id) do nothing;

create policy "authenticated read payment proofs" on storage.objects
  for select to authenticated using (bucket_id = 'payment-proofs');
