-- GrindCourt — seed the two fixed partner accounts into app_users.
--
-- Run this AFTER you've created the two accounts in Supabase Auth
-- (Dashboard -> Authentication -> Users -> Add user, email + password,
-- "Auto Confirm User" checked so no email verification is required).
--
-- Copy each user's UUID from the Auth Users table and paste it below in
-- place of the placeholders, then run this in the SQL Editor.

insert into app_users (id, display_name, slot) values
  ('REPLACE-WITH-PARTNER-A-AUTH-UUID', 'Jay', 'partner_a'),
  ('REPLACE-WITH-PARTNER-B-AUTH-UUID', 'Partner', 'partner_b')
on conflict (id) do update set display_name = excluded.display_name, slot = excluded.slot;
