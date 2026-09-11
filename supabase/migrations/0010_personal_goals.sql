-- Goals need the same visibility scoping tasks already have (see
-- 0009_personal_mode.sql) — Personal mode needs to be able to create real
-- private goals, and right now `goals` has no visibility column and a
-- blanket "authenticated read all" policy, meaning a personal goal's title
-- would be readable by the other partner via direct REST regardless of
-- what the UI shows. Same fix, same pattern.

alter table goals add column if not exists visibility text not null default 'partner' check (visibility in ('partner','personal'));

drop policy if exists "authenticated read all" on goals;
create policy "read partner goals or own personal goals" on goals for select to authenticated
  using (visibility = 'partner' or (visibility = 'personal' and owner_id = auth.uid()));
