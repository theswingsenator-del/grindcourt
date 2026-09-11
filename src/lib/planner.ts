// The Planner — proactive daily task suggestions grounded in real goals and
// history, plus natural-language capture (loose sentence -> structured
// task draft). Suggested tasks land as approval_status='pending' and never
// participate in violation detection until accepted — see violations.ts.

import { SupabaseClient } from "@supabase/supabase-js";
import { askAI } from "./ai";
import { localDateString } from "./timezone";

const PLANNER_SYSTEM_PROMPT = `You are the Planner inside GrindCourt, an accountability app between two business partners. Your job is to propose concrete, achievable tasks for today, grounded in the person's actual goals and recent work — never generic filler.

Rules:
- Only propose tasks that clearly serve one of the goals given, or a sensible standalone task if no goals fit today.
- 1-3 tasks. Each must be completable in a single day.
- Titles are short and imperative ("Ship landing page draft", not "Work on landing page").
- Optionally set a due time today (24h HH:MM) if the task genuinely has a natural deadline; otherwise null. If you do set one, it must fall between 07:00 and 22:00 in the person's own local time (the "today's date" above is already computed in their timezone) — never propose an overnight due time, the person needs to sleep.
- Optionally attach a goal_id if a task clearly serves one of the given goals; otherwise null.
- CRITICAL: never propose tasks that assume money is already flowing (withdrawing earnings, logging revenue received, banking a payout) unless the task history shows an explicit confirmed-earning event already happened (a completed task whose title clearly states a payment/payout was received, e.g. "received first Handshake payout", "client paid invoice"). Before that confirmation exists, stay entirely on setup/execution tasks — the actual work that has to happen before any money can exist. Proposing a withdrawal before there's anything to withdraw is exactly the kind of premature, un-smart suggestion this app must never make.
- You always return strict JSON only, matching the schema given. No markdown, no prose outside the JSON.`;

function extractJSON(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced ? fenced[1] : trimmed;
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start === -1 || end === -1) throw new Error("No JSON array found in AI response");
  return JSON.parse(raw.slice(start, end + 1));
}

export interface SuggestedTaskDraft {
  title: string;
  due_at: string | null;
  goal_id: string | null;
}

function isValidDrafts(value: unknown, validGoalIds: Set<string>): value is SuggestedTaskDraft[] {
  if (!Array.isArray(value) || value.length === 0) return false;
  return value.every((t) => {
    if (typeof t !== "object" || t === null) return false;
    const tt = t as { title?: unknown; due_time?: unknown; goal_id?: unknown };
    if (typeof tt.title !== "string" || !tt.title.trim()) return false;
    if (tt.goal_id !== null && tt.goal_id !== undefined && typeof tt.goal_id === "string" && !validGoalIds.has(tt.goal_id)) return false;
    return true;
  });
}

// Normalizes a title to its significant word set (lowercase, strip
// punctuation, drop short filler words) for a cheap overlap check.
function significantWords(title: string): Set<string> {
  const stop = new Set(["a", "an", "the", "to", "for", "of", "on", "in", "with", "and", "or", "up", "your", "1", "properly"]);
  return new Set(
    title
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w && !stop.has(w))
  );
}

// True if two titles share enough significant words to be "the same task
// again" — e.g. "Set up Handshake profile" vs "Complete Handshake setup"
// both reduce to {handshake, setup/profile} with heavy overlap. Threshold
// tuned to catch this class of near-duplicate without blocking genuinely
// different tasks that happen to share one common word.
function isNearDuplicateTitle(a: string, b: string): boolean {
  const wa = significantWords(a);
  const wb = significantWords(b);
  if (wa.size === 0 || wb.size === 0) return false;
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared += 1;
  const overlap = shared / Math.min(wa.size, wb.size);
  return overlap >= 0.6;
}

/**
 * Proposes today's tasks for a user, grounded in their goals + recent task
 * history. No-ops (returns []) if this user already has an ai_suggested
 * task created today — one suggestion pass per person per day, whether
 * triggered by cron or the manual "Suggest my day" button. "Today" is this
 * user's own local calendar day (per their timezone), not the server's UTC
 * day — a server-midnight cutoff misfires across the Lagos/Indianapolis
 * boundary.
 */
export async function suggestDailyTasks(
  db: SupabaseClient,
  userId: string,
  timezone: string,
  now: Date = new Date()
): Promise<SuggestedTaskDraft[]> {
  const today = localDateString(now, timezone);

  // Widen to a 30h lookback then filter by local calendar date in JS,
  // rather than trusting a server-midnight `gte` bound to line up with
  // this user's local midnight.
  const windowStart = new Date(now.getTime() - 30 * 60 * 60 * 1000);
  const { data: recentSuggested } = await db
    .from("tasks")
    .select("id, created_at")
    .eq("owner_id", userId)
    .eq("source", "ai_suggested")
    .gte("created_at", windowStart.toISOString());
  const alreadySuggestedToday = (recentSuggested ?? []).some(
    (r: { created_at: string }) => localDateString(new Date(r.created_at), timezone) === today
  );
  if (alreadySuggestedToday) return [];

  const { data: goals } = await db.from("goals").select("id,title,description,target_date").eq("owner_id", userId);
  const goalsList = goals ?? [];
  const validGoalIds = new Set(goalsList.map((g: { id: string }) => g.id));

  const { data: recentTasks } = await db
    .from("tasks")
    .select("title,status,completed_at")
    .eq("owner_id", userId)
    .order("created_at", { ascending: false })
    .limit(15);

  const { data: openTasks } = await db
    .from("tasks")
    .select("title")
    .eq("owner_id", userId)
    .neq("status", "done");
  const openTitles = (openTasks ?? []).map((t: { title: string }) => t.title);

  const userPrompt = `Today's date: ${today}

This person's active goals:
${goalsList.length > 0 ? goalsList.map((g: { id: string; title: string; target_date: string | null }) => `- id: ${g.id} | "${g.title}"${g.target_date ? ` (target ${g.target_date})` : ""}`).join("\n") : "(none set yet — propose one sensible standalone task if anything fits, otherwise return an empty array)"}

Recent task history (most recent first):
${(recentTasks ?? []).length > 0 ? (recentTasks ?? []).map((t: { title: string; status: string }) => `- ${t.title} (${t.status})`).join("\n") : "(no history yet)"}

Already on this person's docket right now, NOT done yet — do NOT propose anything that duplicates or restates any of these, even with different wording ("Set up Handshake profile" and "Complete Handshake setup" are the same thing said twice — never do that):
${openTitles.length > 0 ? openTitles.map((t) => `- ${t}`).join("\n") : "(nothing open right now)"}

Propose today's tasks now. Return strict JSON only, an array matching exactly this schema:
[{"title": "string", "due_time": "HH:MM" | null, "goal_id": "string" | null}]

If nothing genuinely fits today (all goals fully staffed with tasks already, or no goals and nothing sensible to propose), return an empty array: []`;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = await askAI(PLANNER_SYSTEM_PROMPT, userPrompt);
      const parsed = extractJSON(raw) as Array<{ title: string; due_time: string | null; goal_id: string | null }>;
      if (isValidDrafts(parsed, validGoalIds)) {
        if (parsed.length === 0) return [];
        const drafts: SuggestedTaskDraft[] = parsed
          .map((p) => ({
            title: p.title.trim(),
            due_at: p.due_time ? `${today}T${p.due_time}:00` : null,
            goal_id: p.goal_id ?? null,
          }))
          .filter((d) => !openTitles.some((existing) => isNearDuplicateTitle(d.title, existing)));
        if (drafts.length === 0) return [];
        const inserted = await db
          .from("tasks")
          .insert(
            drafts.map((d) => ({
              owner_id: userId,
              title: d.title,
              due_at: d.due_at,
              goal_id: d.goal_id,
              status: "pending",
              source: "ai_suggested",
              approval_status: "pending",
            }))
          )
          .select();
        return inserted.data ? drafts : [];
      }
    } catch {
      // fall through to retry
    }
  }
  return [];
}

export interface ParsedTaskDraft {
  title: string;
  due_at: string | null;
  goal_id: string | null;
  goal_title: string | null;
}

// Thrown by parseNaturalLanguageTask when Groq rejects the request with a
// daily token-quota 429 — a real capacity ceiling, not a malformed-response
// retry case. The route catches this specifically to tell the user the
// honest reason ("AI is at its daily limit") instead of the generic
// "couldn't parse that" message, which implies the sentence was the
// problem when it never was.
export class ParseRateLimitError extends Error {
  constructor() {
    super("AI daily quota reached");
    this.name = "ParseRateLimitError";
  }
}

// Its own system prompt, deliberately NOT the shared PLANNER_SYSTEM_PROMPT
// above — that one is written for suggestDailyTasks (propose 1-3 NEW
// tasks as a JSON array). Reusing it here biased the model toward
// array-shaped output even though this function asks for exactly one
// JSON object, which the single-object bracket-scan below can't recover
// from (grabbing from the first "{" to the last "}" across multiple
// objects produces invalid JSON, fails silently, retries with the same
// bad prompt, and always returns null — this was a real live bug, not
// user error: "Could not parse that into a task" fired on ordinary input).
const PARSE_TASK_SYSTEM_PROMPT = `You are helping someone capture a single task from a loose sentence they just typed, inside GrindCourt, an accountability app. Parse their sentence into exactly ONE structured task — never propose additional tasks, never return more than one, even if the sentence could imply several steps. You always return strict JSON only, matching the schema given in the prompt. No markdown, no prose outside the JSON.`;

/**
 * Parses a loose natural-language sentence into a structured task draft.
 * Does NOT insert anything — the caller shows the draft for the user to
 * confirm/edit, then creates it via the normal task-create route (a
 * user-confirmed capture is a manual task, not an ai_suggested one — no
 * approval step needed since the human is standing right there).
 */
export async function parseNaturalLanguageTask(db: SupabaseClient, userId: string, text: string): Promise<ParsedTaskDraft | null> {
  const { data: goals } = await db.from("goals").select("id,title").eq("owner_id", userId);
  const goalsList = goals ?? [];
  const validGoalIds = new Set(goalsList.map((g: { id: string }) => g.id));

  const userPrompt = `Today's date: ${new Date().toISOString().slice(0, 10)}

This person's active goals:
${goalsList.length > 0 ? goalsList.map((g: { id: string; title: string }) => `- id: ${g.id} | "${g.title}"`).join("\n") : "(none)"}

Parse this into a task: "${text}"

Return strict JSON only, matching exactly this schema:
{"title": "short imperative task title", "due_date": "YYYY-MM-DD" | null, "due_time": "HH:MM" | null, "goal_id": "string matching one of the goal ids above, or null"}

Infer a reasonable due date/time only if the text implies one (e.g. "tomorrow", "by 5pm", "next Monday") — otherwise both null. Only set goal_id if the task clearly relates to one of the goals listed.`;

  // 3 attempts, not 2 — confirmed live that even with the correct
  // single-object prompt, the model occasionally still returns malformed
  // JSON on a given try (real stochastic flakiness, reproduced directly
  // against the Groq API on plain input like "4 Sets of 50 Pushups").
  // Two tries occasionally means two bad ones in a row; three makes that
  // materially less likely without the user ever seeing it.
  for (let attempt = 0; attempt < 3; attempt++) {
    let raw: string | undefined;
    try {
      raw = await askAI(PARSE_TASK_SYSTEM_PROMPT, userPrompt);
      const trimmed = raw.trim();
      const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
      const jsonRaw = fenced ? fenced[1] : trimmed;
      // Defensive: if the model returns an array despite the prompt asking
      // for a single object (belt-and-suspenders on top of the dedicated
      // system prompt above), take its first element instead of blindly
      // spanning first-"{"-to-last-"}", which produces invalid JSON across
      // multiple objects and was the actual cause of this ever failing.
      const arrStart = jsonRaw.indexOf("[");
      const arrEnd = jsonRaw.lastIndexOf("]");
      let candidate: unknown;
      if (arrStart !== -1 && arrEnd !== -1 && arrStart < jsonRaw.indexOf("{")) {
        const arr = JSON.parse(jsonRaw.slice(arrStart, arrEnd + 1));
        candidate = Array.isArray(arr) ? arr[0] : arr;
      } else {
        const start = jsonRaw.indexOf("{");
        const end = jsonRaw.lastIndexOf("}");
        if (start === -1 || end === -1) throw new Error("No JSON object found");
        candidate = JSON.parse(jsonRaw.slice(start, end + 1));
      }
      const parsed = candidate as {
        title?: unknown;
        due_date?: unknown;
        due_time?: unknown;
        goal_id?: unknown;
      };
      if (typeof parsed.title !== "string" || !parsed.title.trim()) continue;
      const goalId = typeof parsed.goal_id === "string" && validGoalIds.has(parsed.goal_id) ? parsed.goal_id : null;
      const dueDate = typeof parsed.due_date === "string" ? parsed.due_date : null;
      const dueTime = typeof parsed.due_time === "string" ? parsed.due_time : "23:59";
      const dueAt = dueDate ? `${dueDate}T${dueTime}:00` : null;
      const goalTitle = goalId ? goalsList.find((g: { id: string }) => g.id === goalId)?.title ?? null : null;
      return { title: parsed.title.trim(), due_at: dueAt, goal_id: goalId, goal_title: goalTitle };
    } catch (err) {
      console.error("[parseNaturalLanguageTask] attempt", attempt, "failed:", err, "raw response:", raw);
      // A daily token-quota 429 is a hard wall, not a bad-luck malformed
      // response — retrying against it wastes 2 more round trips for the
      // exact same rejection every time, and the "Could not parse" message
      // is actively misleading here (nothing about the sentence was
      // unparseable). Fail fast with a distinct error the route can turn
      // into an honest message instead.
      if (err instanceof Error && /rate_limit_exceeded|429/.test(err.message)) {
        throw new ParseRateLimitError();
      }
      // fall through to retry
    }
  }
  return null;
}
