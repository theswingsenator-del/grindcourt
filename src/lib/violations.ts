// Violation detection — pure functions over already-fetched rows so the
// cron route (src/app/api/cron/scan/route.ts) can fetch once and reason
// over everything without re-querying per check. Each detector returns the
// set of NEW violations to create (the cron route is responsible for not
// re-creating a violation that's already open for the same trigger).

import { AppUser, DailyLog, Fine, RestDay, Task, Violation, ViolationType } from "./types";
import { localDateString, localHour } from "./timezone";

export interface DetectionInput {
  users: AppUser[];
  tasks: Task[];
  dailyLogs: DailyLog[];
  restDays: RestDay[];
  violations: Violation[];
  fines: Fine[];
  now: Date;
  lateNightCutoffHour: number;
}

export interface NewViolation {
  type: ViolationType;
  user_id: string;
  task_id: string | null;
  details: string;
}

function todayISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// Per-user enforcement launch gate — replaces the old single global
// ENFORCEMENT_START_AT env var (see supabase/migrations/0007_extensions_and_tiers.sql
// and src/app/api/cron/scan/route.ts). Jason and Samuel are launching the
// judicial system at their own local midnight, which are different UTC
// instants, so gating has to be per-user, not global. null means this
// person hasn't launched yet — treated as "never enforce" until an admin
// sets an explicit instant.
export function isEnforcementLive(user: AppUser, now: Date): boolean {
  if (!user.enforcement_start_at) return false;
  return now.getTime() >= new Date(user.enforcement_start_at).getTime();
}

function alreadyOpenForTask(violations: Violation[], type: ViolationType, taskId: string): boolean {
  return violations.some((v) => v.type === type && v.task_id === taskId);
}

function alreadyOpenForUserDay(violations: Violation[], type: ViolationType, userId: string, day: string): boolean {
  return violations.some(
    (v) => v.type === type && v.user_id === userId && v.detected_at.slice(0, 10) === day
  );
}

// Timezone-aware dedup for detectors that must key off the user's own
// local calendar day (missed_log, late_night_activity) rather than the
// server's UTC day — otherwise dedup drifts near the UTC day boundary for
// whichever user isn't aligned with UTC.
function alreadyOpenForUserLocalDay(
  violations: Violation[],
  type: ViolationType,
  userId: string,
  localDay: string,
  timezone: string
): boolean {
  return violations.some(
    (v) => v.type === type && v.user_id === userId && localDateString(new Date(v.detected_at), timezone) === localDay
  );
}

// 1. Overdue tasks — the local calendar day containing due_at has fully
// closed (in the task owner's own timezone) while the task is still
// pending. This is deliberately NOT "due_at has passed" — a task finished
// an hour late on the same local day is a small late_completion fine
// instead (issued at completion time, see src/app/api/tasks/route.ts),
// never this big-ladder violation. Only once the day due_at fell on is
// truly over, with the task still pending, does this fire.
export function detectOverdueTasks(input: DetectionInput): NewViolation[] {
  const out: NewViolation[] = [];
  const usersById = new Map(input.users.map((u) => [u.id, u]));
  const tasksById = new Map(input.tasks.map((t) => [t.id, t]));
  for (const task of input.tasks) {
    if (task.status !== "pending" || !task.due_at) continue;
    // Personal tasks are self-managed with self-imposed stakes — the AI
    // Judge's ladder never applies to them (no partner to be fair/unfair
    // between), so they can never trigger this violation.
    if (task.visibility === "personal") continue;
    // A Planner-suggested task that hasn't been accepted yet is not a real
    // commitment — it must never be able to trigger a fine.
    if (task.approval_status === "pending") continue;
    // A task still waiting on its dependency (blocked_by_task_id set and
    // that task isn't done yet) can't have been missed by choice — same
    // safety principle as the approval_status=='pending' skip above.
    if (task.blocked_by_task_id) {
      const blocker = tasksById.get(task.blocked_by_task_id);
      if (blocker && blocker.status !== "done") continue;
    }
    const owner = usersById.get(task.owner_id);
    if (!owner || !isEnforcementLive(owner, input.now)) continue;
    const dueAt = new Date(task.due_at);
    if (dueAt.getTime() >= input.now.getTime()) continue;
    if (localDateString(input.now, owner.timezone) <= localDateString(dueAt, owner.timezone)) continue;
    if (alreadyOpenForTask(input.violations, "task_overdue", task.id)) continue;
    out.push({
      type: "task_overdue",
      user_id: task.owner_id,
      task_id: task.id,
      details: `Task "${task.title}" was due ${task.due_at} and is still pending.`,
    });
  }
  return out;
}

// Did this user have any real partner-visible activity on the given local
// day — a task due that day, or a task actually completed that day? Used
// to gate missed_log below. Personal (visibility='personal') tasks never
// count here — they're self-managed with self-imposed stakes, no partner
// accountability angle, so they can't be the thing that makes a check-in
// "required."
function hadPartnerActivityOnLocalDay(tasks: Task[], userId: string, localDay: string, timezone: string): boolean {
  return tasks.some((t) => {
    if (t.owner_id !== userId || t.visibility !== "partner") return false;
    // An unapproved Planner suggestion isn't a real commitment yet (same
    // reasoning as detectOverdueTasks above skipping approval_status ===
    // "pending") — it must not be able to conjure up a check-in
    // requirement out of thin air either.
    if (t.approval_status !== "approved") return false;
    if (t.due_at && localDateString(new Date(t.due_at), timezone) === localDay) return true;
    if (t.completed_at && localDateString(new Date(t.completed_at), timezone) === localDay) return true;
    return false;
  });
}

// 2. Missed daily logs — no daily_logs row (or neither commit/report done)
// for yesterday, checked once the day has fully turned over. "Yesterday"
// and "today" are computed per-user in THEIR OWN timezone — a global
// server-UTC today/yesterday would be the wrong calendar day for whichever
// partner isn't aligned with UTC.
//
// Reworked 2026-08 — this used to fire unconditionally: miss both slots on
// a day with literally nothing on the docket and it was still a violation.
// Jay's complaint, verbatim: "if there are no tasks how do I log to avoid
// the fines... even me sef I don't know how to avoid it." The check-in
// requirement is now gated on actual activity — a day only NEEDS a
// check-in if the user had at least one partner-visible task due or
// completed that day (see hadPartnerActivityOnLocalDay above). A
// genuinely empty day can never generate this violation, no matter what
// you do or don't log.
export function detectMissedLogs(input: DetectionInput): NewViolation[] {
  const out: NewViolation[] = [];
  const yesterdayInstant = new Date(input.now.getTime() - 24 * 60 * 60 * 1000);

  for (const user of input.users) {
    if (!isEnforcementLive(user, input.now)) continue;
    const today = localDateString(input.now, user.timezone);
    const y = localDateString(yesterdayInstant, user.timezone);

    if (!hadPartnerActivityOnLocalDay(input.tasks, user.id, y, user.timezone)) continue;

    const log = input.dailyLogs.find((l) => l.owner_id === user.id && l.log_date === y);
    const missed = !log || (!log.morning_commit_done && !log.night_report_done);
    if (!missed) continue;
    // Dedup against TODAY, not yesterday: the violation row is stamped
    // detected_at = now() (today) when created, even though it's about
    // yesterday's missing log — comparing against yesterday's date here
    // never matched, so this fired on every single cron run instead of
    // once per day. Bug found live 2026-08-06: climbed both accounts to
    // the ₦150,000 ladder ceiling within ~90 minutes of deploy.
    if (alreadyOpenForUserLocalDay(input.violations, "missed_log", user.id, today, user.timezone)) continue;
    out.push({
      type: "missed_log",
      user_id: user.id,
      task_id: null,
      details: `No check-in logged for ${y}.`,
    });
  }
  return out;
}

// 3. Late-night activity pattern — a task was completed or a daily log was
// written after the configured cutoff hour, repeatedly (2+ times in the
// trailing 7 days). One clean late night isn't a violation; a pattern is.
export function detectLateNightActivity(input: DetectionInput): NewViolation[] {
  const out: NewViolation[] = [];
  const cutoff = input.lateNightCutoffHour;
  const sevenDaysAgo = new Date(input.now);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  for (const user of input.users) {
    if (!isEnforcementLive(user, input.now)) continue;
    let lateEvents = 0;
    for (const task of input.tasks) {
      if (task.owner_id !== user.id || !task.completed_at) continue;
      const d = new Date(task.completed_at);
      if (d < sevenDaysAgo) continue;
      if (localHour(d, user.timezone) >= cutoff) lateEvents++;
    }
    for (const log of input.dailyLogs) {
      if (log.owner_id !== user.id) continue;
      for (const ts of [log.morning_commit_at, log.night_report_at]) {
        if (!ts) continue;
        const d = new Date(ts);
        if (d < sevenDaysAgo) continue;
        if (localHour(d, user.timezone) >= cutoff) lateEvents++;
      }
    }
    if (lateEvents < 2) continue;
    const today = localDateString(input.now, user.timezone);
    if (alreadyOpenForUserLocalDay(input.violations, "late_night_activity", user.id, today, user.timezone)) continue;
    out.push({
      type: "late_night_activity",
      user_id: user.id,
      task_id: null,
      details: `${lateEvents} activity events after ${cutoff}:00 in the trailing 7 days.`,
    });
  }
  return out;
}

// 4. Unbudgeted rest — spent rest days exceed earned rest days (negative
// running balance) for a user.
export function detectUnbudgetedRest(input: DetectionInput): NewViolation[] {
  const out: NewViolation[] = [];
  for (const user of input.users) {
    if (!isEnforcementLive(user, input.now)) continue;
    const rows = input.restDays.filter((r) => r.owner_id === user.id);
    const balance = rows.reduce((sum, r) => sum + (r.kind === "earned" ? r.delta : -Math.abs(r.delta)), 0);
    if (balance >= 0) continue;
    const today = todayISO(input.now);
    if (alreadyOpenForUserDay(input.violations, "unbudgeted_rest", user.id, today)) continue;
    out.push({
      type: "unbudgeted_rest",
      user_id: user.id,
      task_id: null,
      details: `Rest day balance is ${balance} — spent more than earned.`,
    });
  }
  return out;
}

// 5. Repeat excuse pattern — the same (or near-identical) bid/appeal reason
// text used across multiple violations by the same user. Simple normalized
// exact-match on trimmed lowercase text kept intentionally simple/explicit
// rather than fuzzy — false positives here are worse than false negatives.
export function detectRepeatExcuse(
  users: AppUser[],
  reasonTextsByUser: Map<string, string[]>,
  violations: Violation[],
  now: Date
): NewViolation[] {
  const out: NewViolation[] = [];
  for (const user of users) {
    if (!isEnforcementLive(user, now)) continue;
    const reasons = reasonTextsByUser.get(user.id) ?? [];
    const normalized = reasons.map((r) => r.trim().toLowerCase());
    const counts = new Map<string, number>();
    for (const r of normalized) {
      if (!r) continue;
      counts.set(r, (counts.get(r) ?? 0) + 1);
    }
    const repeated = [...counts.entries()].find(([, count]) => count >= 2);
    if (!repeated) continue;
    const today = todayISO(now);
    if (alreadyOpenForUserDay(violations, "repeat_excuse", user.id, today)) continue;
    out.push({
      type: "repeat_excuse",
      user_id: user.id,
      task_id: null,
      details: `Same excuse used ${repeated[1]}x: "${repeated[0]}"`,
    });
  }
  return out;
}

// 6. Ignored nags — a fine has been issued (not paid_approved / not
// appeal_denied-and-closed) for more than N escalation cycles (each cron
// run = one escalation opportunity) with zero user response (no bid, no
// appeal, no proof uploaded). Tracked via fine age here; the cron route
// counts escalations by re-scanning open fines each run.
const IGNORED_NAG_DAYS = 3;

export function detectIgnoredNags(
  fines: Fine[],
  fineHasResponse: (fineId: string) => boolean,
  violations: Violation[],
  now: Date,
  users: AppUser[]
): NewViolation[] {
  const out: NewViolation[] = [];
  const usersById = new Map(users.map((u) => [u.id, u]));
  for (const fine of fines) {
    const owner = usersById.get(fine.user_id);
    if (!owner || !isEnforcementLive(owner, now)) continue;
    if (fine.status === "paid_approved" || fine.status === "appeal_denied") continue;
    const ageMs = now.getTime() - new Date(fine.created_at).getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    if (ageDays < IGNORED_NAG_DAYS) continue;
    if (fineHasResponse(fine.id)) continue;
    const today = todayISO(now);
    if (alreadyOpenForUserDay(violations, "ignored_nags", fine.user_id, today)) continue;
    out.push({
      type: "ignored_nags",
      user_id: fine.user_id,
      task_id: null,
      details: `Fine ${fine.id} has been open ${Math.floor(ageDays)} days with no bid, appeal, or proof.`,
    });
  }
  return out;
}
