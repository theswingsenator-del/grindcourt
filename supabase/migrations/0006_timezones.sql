-- GrindCourt — per-user timezones.
--
-- Bug: the whole violation-detection system (missed_log detection, the
-- late-night-activity cutoff hour, the Predictor's day-of-week pattern)
-- computed "today"/"yesterday" and hour-of-day from a single server-UTC
-- clock. Jason is in Africa/Lagos (WAT, UTC+1 year-round), Samuel is in
-- America/Indiana/Indianapolis (US Eastern, observes EDT/EST) — a 5-6 hour
-- offset depending on DST, so whichever partner wasn't aligned with UTC
-- got the wrong calendar day / wrong hour. Fixed app-side in
-- lib/timezone.ts + lib/violations.ts + lib/predictor.ts + lib/planner.ts;
-- this migration just adds the column those fixes read from.
--
-- Mapping used here follows app_users.slot (the one field guaranteed to be
-- correct in every environment): partner_a = Jason = Africa/Lagos,
-- partner_b = Samuel = America/Indiana/Indianapolis. Also matched on
-- display_name in case it was seeded as "Jason"/"Samuel" literally, so
-- this is safe to run regardless of which convention the live seed used.
-- Safe to re-run.

alter table app_users add column if not exists timezone text not null default 'UTC';

update app_users
set timezone = 'Africa/Lagos'
where slot = 'partner_a' or display_name ilike 'jason%';

update app_users
set timezone = 'America/Indiana/Indianapolis'
where slot = 'partner_b' or display_name ilike 'samuel%';
