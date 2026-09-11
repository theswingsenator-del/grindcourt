-- GrindCourt — schema v9: Personal Mode
--
-- Adds a private "Personal Mode" alongside the existing Partner Mode: solo
-- task/goal management that is completely invisible to the other partner,
-- plus self-imposed "personal stakes" — a private commitment-device ledger
-- entry the owner sets and resolves themselves (no AI Judge, no dispute
-- mechanism, no partner involvement — there's nobody to be unfair to).
--
-- Privacy boundary: RLS on `tasks` and `personal_stakes`, NOT client-side
-- filtering. A devtools-savvy partner must not be able to fetch the other
-- person's visibility='personal' tasks or personal_stakes rows via the
-- browser (anon-key, RLS-scoped) client. All writes still go through the
-- Next.js API routes using the service-role admin client, which bypasses
-- RLS entirely — RLS here only governs what the browser client can SELECT.

alter table tasks
  add column if not exists visibility text not null default 'partner' check (visibility in ('partner', 'personal'));

create table if not exists personal_stakes (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  task_id uuid not null references tasks(id) on delete cascade,
  owner_id uuid not null references app_users(id) on delete cascade,
  amount numeric not null,
  status text not null default 'active' check (status in ('active', 'paid', 'waived')),
  paid_at timestamptz
);

create index if not exists personal_stakes_owner_idx on personal_stakes(owner_id);
create index if not exists personal_stakes_task_idx on personal_stakes(task_id);

alter table personal_stakes enable row level security;

-- Replace the blanket "authenticated read all" policy on tasks: partner-
-- visibility tasks stay readable by both partners as before; personal-
-- visibility tasks are readable only by their own owner.
drop policy if exists "authenticated read all" on tasks;
create policy "read partner tasks or own personal tasks" on tasks
  for select to authenticated
  using (visibility = 'partner' or (visibility = 'personal' and owner_id = auth.uid()));

-- personal_stakes gets a real owner-only read policy — no "read all"
-- default for this table, ever.
create policy "owner read own personal stakes" on personal_stakes
  for select to authenticated
  using (owner_id = auth.uid());
