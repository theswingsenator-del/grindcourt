// The Auditor — silent anti-gaming detection. Watches for trivial task
// padding (suspiciously short/low-effort tasks marked done to inflate
// completion counts). Stays completely silent until a user has a personal
// baseline (5-7 completed tasks), and ONLY ever compares a user to their
// own history — never to their partner's. Log-only for now: never produces
// a visible accusation, because the Judge's neutrality can never be
// undermined by a false positive here.

import { SupabaseClient } from "@supabase/supabase-js";

const BASELINE_THRESHOLD = 5;
const PADDING_RATIO = 0.35;

/**
 * Recomputes and upserts this user's average completed-task title length
 * and sample size. Call after any task transitions to done.
 */
export async function updateBaseline(db: SupabaseClient, userId: string): Promise<void> {
  const { data: doneTasks } = await db
    .from("tasks")
    .select("title")
    .eq("owner_id", userId)
    .eq("status", "done");

  const titles = (doneTasks ?? []).map((t: { title: string }) => t.title);
  const sampleSize = titles.length;
  const avgLength = sampleSize > 0 ? titles.reduce((sum, t) => sum + t.length, 0) / sampleSize : 0;

  await db.from("auditor_baseline").upsert(
    {
      user_id: userId,
      avg_title_length: avgLength,
      sample_size: sampleSize,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" }
  );
}

/**
 * Returns true only if this user has a large enough baseline AND the given
 * task title is suspiciously short relative to their own history. A
 * deliberately conservative threshold — false positives here are worse
 * than false negatives. Does NOT create a violation or fine; log-only,
 * inserts an auditor_flags row for future review.
 */
export async function checkForPadding(
  db: SupabaseClient,
  userId: string,
  taskId: string,
  taskTitle: string
): Promise<boolean> {
  const { data: baseline } = await db
    .from("auditor_baseline")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (!baseline || baseline.sample_size < BASELINE_THRESHOLD) return false;
  if (taskTitle.length >= baseline.avg_title_length * PADDING_RATIO) return false;

  await db.from("auditor_flags").insert({
    user_id: userId,
    task_id: taskId,
    note: `Title length ${taskTitle.length} is under ${Math.round(PADDING_RATIO * 100)}% of this user's own baseline average (${baseline.avg_title_length.toFixed(1)}, n=${baseline.sample_size}). Log-only — no consequence applied.`,
  });

  return true;
}
