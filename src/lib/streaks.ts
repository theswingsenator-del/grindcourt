// Clean streak — consecutive calendar days (in the user's own local
// timezone) with zero violations, walking backward from today. Computed
// live from the violations table, no schema needed.

import { SupabaseClient } from "@supabase/supabase-js";
import { AppUser, Violation } from "./types";
import { localDateString } from "./timezone";

const MAX_LOOKBACK_DAYS = 3650;

/**
 * Counts the user's current clean streak in days. Stops at the first local
 * day with >=1 violation, or when it reaches a day before
 * enforcement_start_at's local date (nothing to count before enforcement
 * existed for this person). Returns 0 if enforcement hasn't started yet.
 */
export async function computeCleanStreak(db: SupabaseClient, user: AppUser, now: Date = new Date()): Promise<number> {
  if (!user.enforcement_start_at) return 0;

  const { data: violations } = await db
    .from("violations")
    .select("id,detected_at")
    .eq("user_id", user.id);

  const violationDays = new Set(
    ((violations ?? []) as Pick<Violation, "id" | "detected_at">[]).map((v) =>
      localDateString(new Date(v.detected_at), user.timezone)
    )
  );

  const enforcementStartLocalDay = localDateString(new Date(user.enforcement_start_at), user.timezone);

  let streak = 0;
  const cursor = new Date(now);
  for (let i = 0; i < MAX_LOOKBACK_DAYS; i++) {
    const dayStr = localDateString(cursor, user.timezone);
    if (dayStr < enforcementStartLocalDay) break;
    if (violationDays.has(dayStr)) break;
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}
