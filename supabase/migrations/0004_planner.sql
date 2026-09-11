-- GrindCourt — Stage 8: The Planner
-- Proactive daily task suggestions + natural-language task capture.
-- Run AFTER 0001-0003. Safe to re-run.

-- tasks: distinguish AI-suggested tasks (need approval before they count
-- toward anything — never trigger a fine while pending) from manual ones.
alter table tasks add column if not exists source text not null default 'manual' check (source in ('manual', 'ai_suggested'));
alter table tasks add column if not exists approval_status text not null default 'approved' check (approval_status in ('approved', 'pending'));
