// issueFine() — the single choke point that turns a detected violation
// into a violation row + a fine row on the ladder + a notification. Used
// by both the cron scan route (automated detection) and the dispute route
// (false_complete, issued the moment a partner's dispute is upheld).

import { createSupabaseAdminClient } from "./supabaseServer";
import { ladderStep, severityForType, formatNaira } from "./fines";
import { notify } from "./notify";
import { Fine, Violation, ViolationType } from "./types";

export interface IssueFineResult {
  violation: Violation;
  fine: Fine;
}

// Clean days needed since the last violation of a given type before the
// ladder resets to rung 1 for that type. 3 days mirrors the existing
// IGNORED_NAG_DAYS threshold used elsewhere for consistency.
const DECAY_RESET_DAYS = 3;

export async function issueFine(
  userId: string,
  type: ViolationType,
  taskId: string | null,
  details: string
): Promise<IssueFineResult | null> {
  const db = createSupabaseAdminClient();
  if (!db) return null;

  // Decay ladder: occurrence is NOT a lifetime count — that made the rung
  // a one-way ratchet (5 violations ever = stuck at the ₦150k ceiling
  // forever, even after turning things around, which is exactly what
  // happened live and made the whole system feel pointless). Instead,
  // climb from the last violation of this type ONLY if it's recent; a
  // genuine clean gap resets back to rung 1. Escalation still behaves
  // exactly as before within a live streak — only the "never comes back
  // down" part is fixed.
  const { data: lastViolation } = await db
    .from("violations")
    .select("detected_at, streak_count_at_time")
    .eq("user_id", userId)
    .eq("type", type)
    .order("detected_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const daysSinceLast = lastViolation
    ? (Date.now() - new Date(lastViolation.detected_at).getTime()) / (1000 * 60 * 60 * 24)
    : Infinity;
  const occurrence =
    !lastViolation || daysSinceLast >= DECAY_RESET_DAYS ? 1 : lastViolation.streak_count_at_time + 1;
  const severity = severityForType(type);

  // Predictor forfeit wiring: if this user has an unacknowledged nudge from
  // today that hasn't already been tied to a violation, this violation
  // forfeits appeal eligibility — ignoring a heads-up nudge counts against
  // the ignorer specifically.
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const { data: openNudge } = await db
    .from("predictor_nudges")
    .select("*")
    .eq("user_id", userId)
    .eq("acknowledged", false)
    .is("resulted_in_violation_id", null)
    .gte("created_at", todayStart.toISOString())
    .maybeSingle();

  const { data: violation, error: vErr } = await db
    .from("violations")
    .insert({
      type,
      user_id: userId,
      task_id: taskId,
      severity,
      streak_count_at_time: occurrence,
      details,
      appeal_forfeited: Boolean(openNudge),
    })
    .select()
    .single();
  if (vErr || !violation) return null;

  if (openNudge) {
    await db.from("predictor_nudges").update({ resulted_in_violation_id: violation.id }).eq("id", openNudge.id);
  }

  const { rung, amount } = ladderStep(type, occurrence);

  const { data: fine, error: fErr } = await db
    .from("fines")
    .insert({
      violation_id: violation.id,
      user_id: userId,
      amount,
      rung,
      status: "issued",
    })
    .select()
    .single();
  if (fErr || !fine) return null;

  await notify({
    userId,
    type: "fine_issued",
    title: `Fine issued — ${formatNaira(amount)}`,
    body: `${type.replace(/_/g, " ")}: ${details}`,
    relatedFineId: fine.id,
    relatedTaskId: taskId ?? undefined,
  });

  return { violation, fine };
}
