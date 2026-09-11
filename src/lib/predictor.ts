// The Predictor — pattern-mines each person's OWN check-in history for a
// day-of-week failure signature and nudges before the deadline. Never
// compares the two partners to each other. Intentionally a simple
// frequency heuristic (small data volume, not real ML) — do not overbuild.

import { SupabaseClient } from "@supabase/supabase-js";
import { askAI } from "./ai";
import { notify } from "./notify";
import { AppUser, Violation } from "./types";
import { localDateString, localDayOfWeek } from "./timezone";
import { isEnforcementLive } from "./violations";

const PREDICTOR_SYSTEM_PROMPT = `You are the Predictor inside GrindCourt, an accountability app. You write short, honest heads-up notifications to ONE user about THEIR OWN historical pattern of missing check-ins on a specific day of the week. You never compare them to their partner — you only ever reference their own past.

Voice rules:
- Direct and honest, not preachy. State the pattern plainly, then a short nudge.
- 1-2 sentences. No emoji spam.
- Never invent numbers not given in context.
- Output strict JSON only matching the schema in the prompt.`;

function extractJSON(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced ? fenced[1] : trimmed;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("No JSON object found in AI response");
  return JSON.parse(raw.slice(start, end + 1));
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const PATTERN_THRESHOLD = 2;

/**
 * Groups this user's missed_log violations by day-of-week (derived from
 * detected_at, converted to THIS user's own local timezone — a server-UTC
 * day-of-week would be the wrong day for whichever partner isn't aligned
 * with UTC). Returns the day-of-week (0-6) with >= 2 occurrences, or null
 * if no day meets the threshold.
 */
export async function detectPattern(db: SupabaseClient, userId: string, timezone: string): Promise<number | null> {
  const { data: violations } = await db
    .from("violations")
    .select("*")
    .eq("user_id", userId)
    .eq("type", "missed_log");

  const counts = new Map<number, number>();
  for (const v of (violations ?? []) as Violation[]) {
    const day = localDayOfWeek(new Date(v.detected_at), timezone);
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }

  let best: number | null = null;
  let bestCount = 0;
  for (const [day, count] of counts.entries()) {
    if (count >= PATTERN_THRESHOLD && count > bestCount) {
      best = day;
      bestCount = count;
    }
  }
  return best;
}

/**
 * If today matches a detected pattern day for this user AND they haven't
 * logged today yet AND no nudge has already been sent today, sends one.
 * Retries once on a malformed AI response, then falls back to a plain
 * templated nudge — never lets an AI hiccup silently skip the nudge.
 */
export async function maybeSendNudge(
  db: SupabaseClient,
  userId: string,
  timezone: string,
  now: Date = new Date()
): Promise<boolean> {
  // A pre-emptive nudge about enforcement that hasn't started yet for this
  // person doesn't make sense — same per-user gate as violation detection.
  const { data: user } = await db.from("app_users").select("*").eq("id", userId).maybeSingle();
  if (!user || !isEnforcementLive(user as AppUser, now)) return false;

  const patternDay = await detectPattern(db, userId, timezone);
  if (patternDay === null) return false;
  if (localDayOfWeek(now, timezone) !== patternDay) return false;

  const today = localDateString(now, timezone);
  const { data: todayLog } = await db
    .from("daily_logs")
    .select("*")
    .eq("owner_id", userId)
    .eq("log_date", today)
    .maybeSingle();
  if (todayLog && (todayLog.morning_commit_done || todayLog.night_report_done)) return false;

  const { count: priorCount } = await db
    .from("violations")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("type", "missed_log");
  const occurrences = priorCount ?? 0;

  // Widen to a 30h lookback then filter by local calendar date in JS —
  // a naive `${today}T00:00:00Z` bound assumes UTC midnight lines up with
  // this user's local midnight, which is exactly the bug being fixed here.
  const windowStart = new Date(now.getTime() - 30 * 60 * 60 * 1000);
  const { data: recentNudges } = await db
    .from("predictor_nudges")
    .select("id, created_at")
    .eq("user_id", userId)
    .gte("created_at", windowStart.toISOString());
  const existingNudge = (recentNudges ?? []).some(
    (n: { created_at: string }) => localDateString(new Date(n.created_at), timezone) === today
  );
  if (existingNudge) return false;

  const dayName = DAY_NAMES[patternDay];
  const userPrompt = `This user has missed their check-in on a ${dayName} at least ${PATTERN_THRESHOLD} times before (${occurrences} missed_log violations total, historically). Today is ${dayName} and they haven't checked in yet.

Return strict JSON only matching exactly this schema:
{"title": "short push-notification title, under 40 chars", "message": "1-2 sentence honest heads-up referencing the ${dayName} pattern"}`;

  let title = `${dayName} pattern`;
  let message = `You've missed your check-in on a ${dayName} before — don't make it another one. Log in before the day turns over.`;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = await askAI(PREDICTOR_SYSTEM_PROMPT, userPrompt);
      const parsed = extractJSON(raw) as Partial<{ title: string; message: string }>;
      if (typeof parsed.title === "string" && typeof parsed.message === "string") {
        title = parsed.title;
        message = parsed.message;
        break;
      }
    } catch {
      // fall through to retry, then fall back to the templated default above
    }
  }

  await db.from("predictor_nudges").insert({
    user_id: userId,
    day_of_week: patternDay,
    message,
    acknowledged: false,
  });

  await notify({
    userId,
    type: "predictor_nudge",
    title,
    body: message,
  });

  return true;
}
