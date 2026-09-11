// The fine ladder. Flat, uncapped-feeling but hard-clamped at the stated
// ceiling. Climbs per repeat offense of the SAME violation type for the
// SAME user — streak_count_at_time on the violation row is "this is the
// Nth time this user has done THIS violation type", and the rung is
// derived from that Nth count plus the violation type's starting severity.

import { ViolationType } from "./types";

const LADDER = [10_000, 25_000, 50_000, 100_000, 150_000] as const;
const CEILING = 150_000;

// Some violation types are worse out of the gate (start higher on the
// ladder) or escalate faster (skip rungs per repeat) per the spec:
// - false_complete, unbudgeted_rest → start at rung 1 (same as everything
//   else) but are inherently high-severity, so they're marked severity
//   "high"/"standard" for display/nag-tone purposes even at rung 1.
// - task_overdue, missed_log → standard pace, one rung per repeat.
// - late_night_activity, ignored_nags → escalate FASTER: each repeat
//   climbs two rungs instead of one.
// - repeat_excuse → standard pace (it's already a second-order violation
//   by definition, detected after the fact).
const FAST_ESCALATION: ViolationType[] = ["late_night_activity", "ignored_nags"];
const START_LOW: ViolationType[] = ["false_complete", "unbudgeted_rest"];

// late_completion — a task finished late but on the SAME local calendar
// day as its deadline (see lib/violations.ts detectOverdueTasks and
// src/app/api/tasks/route.ts's markingDone block). Deliberately its own
// tiny, flat-capped ladder, entirely separate from the main 5-rung ladder
// above: rung 1 = ₦500, every repeat after that = ₦1,000 flat, never
// climbing past that regardless of how many repeats.
const LATE_COMPLETION_LADDER = [500, 1_000] as const;
const LATE_COMPLETION_CEILING = 1_000;

/**
 * Given the Nth occurrence (1-indexed) of a violation type for a user,
 * returns the ladder rung (1-5+) and the clamped fine amount.
 */
export function ladderStep(
  type: ViolationType,
  occurrenceCount: number
): { rung: number; amount: number } {
  const n = Math.max(1, occurrenceCount);

  if (type === "late_completion") {
    const rung = Math.min(n, LATE_COMPLETION_LADDER.length);
    const amount = Math.min(LATE_COMPLETION_LADDER[rung - 1], LATE_COMPLETION_CEILING);
    return { rung, amount };
  }

  const stepsPerRepeat = FAST_ESCALATION.includes(type) ? 2 : 1;
  // START_LOW types still start at rung 1 — they're flagged low-start in
  // that they never get an extra head-start penalty the way fast-escalation
  // types get an extra climb per repeat. Kept explicit for clarity/tuning.
  const startOffset = START_LOW.includes(type) ? 0 : 0;
  const rawRung = 1 + startOffset + (n - 1) * stepsPerRepeat;
  const rung = Math.min(rawRung, LADDER.length);
  const amount = Math.min(LADDER[rung - 1], CEILING);
  return { rung, amount };
}

export function severityForType(type: ViolationType): "low" | "standard" | "high" {
  if (type === "late_completion") return "low";
  if (FAST_ESCALATION.includes(type)) return "high";
  if (START_LOW.includes(type)) return "standard";
  return "standard";
}

export function formatNaira(amount: number): string {
  return `₦${amount.toLocaleString("en-NG")}`;
}

export function formatUsd(amount: number): string {
  return `$${amount.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

export const FINE_LADDER_TABLE = LADDER;
export const FINE_CEILING = CEILING;
