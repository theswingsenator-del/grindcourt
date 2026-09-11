// Outcome Check-ins — some tasks carry an implicit real-world target
// (revenue, a specific measurable result) beyond just "did you check the
// box." When such a task is marked done, promptCheckin() asks a quick
// honest follow-up; assessCheckinResponse() reads the answer and, if the
// outcome flopped, generates corrective follow-up tasks instead of just
// moving on. Same retry-once-then-safe-fallback AI pattern as judge.ts.

import { SupabaseClient } from "@supabase/supabase-js";
import { askAI } from "./ai";
import { notify } from "./notify";
import { Task, TaskCheckin } from "./types";

const CHECKIN_SYSTEM_PROMPT = `You are the Planner inside GrindCourt, an accountability app between two business partners. Your job here is to be a grounded, no-nonsense assessor: given a task title that implied a real-world outcome, and the person's own free-text account of what actually happened, decide honestly whether it landed.

Rules:
- Judge only the account given. Do not assume the worst on ambiguous or brief answers — that's what "unclear" is for.
- "on_track": the outcome was hit, or is reasonably close to what the task implied.
- "short": the outcome clearly fell short or didn't happen, even though the task got checked off.
- "unclear": you genuinely cannot tell from the account given — don't default to punitive.
- If "short", propose 1-2 concrete corrective follow-up tasks that address the SPECIFIC gap the person described — grounded in their own words, never generic filler.
- You always return strict JSON only, matching the schema given. No markdown, no prose outside the JSON.`;

function extractJSON(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced ? fenced[1] : trimmed;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("No JSON object found in AI response");
  return JSON.parse(raw.slice(start, end + 1));
}

/**
 * Deterministic, cheap heuristic — no AI call. Decides whether completing
 * this task should even trigger a check-in prompt. Most tasks (setup,
 * admin, routine) should NOT prompt; only ones tied to a real, measurable
 * outcome should.
 */
export function looksOutcomeSensitive(title: string, goalTitle: string | null): boolean {
  const text = `${title} ${goalTitle ?? ""}`;
  if (/[$₦]/.test(text)) return true;
  return /\b(earn|earning|revenue|payout|withdraw|handshake|client paid|invoice|sale|sold|close[ds]?)\b/i.test(text);
}

/**
 * Inserts a task_checkins row and notifies the user with a short honest
 * question referencing the actual task title.
 */
export async function promptCheckin(db: SupabaseClient, taskId: string, userId: string): Promise<TaskCheckin | null> {
  const { data: task } = await db.from("tasks").select("title").eq("id", taskId).single();
  const taskTitle = task?.title ?? "that task";

  const { data: checkin, error } = await db
    .from("task_checkins")
    .insert({ task_id: taskId, user_id: userId, prompted_at: new Date().toISOString() })
    .select()
    .single();
  if (error || !checkin) return null;

  await notify({
    userId,
    type: "outcome_checkin",
    title: "Quick check-in",
    body: `Did "${taskTitle}" actually land, or did it come up short?`,
    relatedTaskId: taskId,
  });

  return checkin as TaskCheckin;
}

export interface CheckinFollowUpDraft {
  title: string;
  due_time: string | null;
}

export interface CheckinAssessmentResult {
  assessment: "on_track" | "short" | "unclear";
  reasoning: string;
  follow_up_tasks: CheckinFollowUpDraft[];
}

function isValidResult(value: unknown): value is CheckinAssessmentResult {
  if (typeof value !== "object" || value === null) return false;
  const v = value as { assessment?: unknown; follow_up_tasks?: unknown };
  if (v.assessment !== "on_track" && v.assessment !== "short" && v.assessment !== "unclear") return false;
  if (v.follow_up_tasks !== undefined && !Array.isArray(v.follow_up_tasks)) return false;
  return true;
}

/**
 * Assesses a check-in response via AI, retries once on a malformed
 * response, then falls back to {assessment: "unclear", follow_up_tasks: []}
 * — never invents a punitive assessment on an AI hiccup. If the assessment
 * is "short", follow-up tasks are inserted the same way Planner
 * suggestions are (source: 'ai_suggested', approval_status: 'pending'),
 * and the checkin row is updated with the response/assessment.
 */
export async function assessCheckinResponse(
  db: SupabaseClient,
  checkin: TaskCheckin,
  task: Task,
  responseText: string
): Promise<CheckinAssessmentResult> {
  const userPrompt = `Today's date: ${new Date().toISOString().slice(0, 10)}

Task title: "${task.title}"
Person's own account of what actually happened: "${responseText}"

Return strict JSON only, matching exactly this schema:
{"assessment": "on_track" | "short" | "unclear", "reasoning": "one sentence", "follow_up_tasks": [{"title": "string", "due_time": "HH:MM" | null}]}

follow_up_tasks must be an empty array unless assessment is "short" — in that case propose 1-2 concrete corrective tasks grounded in exactly what the person said fell short.`;

  let result: CheckinAssessmentResult | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = await askAI(CHECKIN_SYSTEM_PROMPT, userPrompt);
      const parsed = extractJSON(raw);
      if (isValidResult(parsed)) {
        const followUps = parsed.assessment === "short" ? (parsed.follow_up_tasks ?? []) : [];
        result = {
          assessment: parsed.assessment,
          reasoning: typeof (parsed as { reasoning?: unknown }).reasoning === "string" ? (parsed as { reasoning: string }).reasoning : "No reasoning provided.",
          follow_up_tasks: followUps.filter(
            (t): t is CheckinFollowUpDraft => typeof t === "object" && t !== null && typeof t.title === "string" && t.title.trim().length > 0
          ),
        };
        break;
      }
    } catch {
      // fall through to retry
    }
  }

  if (!result) {
    result = {
      assessment: "unclear",
      reasoning: "The Planner could not reach a clean assessment (AI response was malformed after retry).",
      follow_up_tasks: [],
    };
  }

  let followUpCreated = false;
  if (result.assessment === "short" && result.follow_up_tasks.length > 0) {
    const today = new Date().toISOString().slice(0, 10);
    const inserted = await db
      .from("tasks")
      .insert(
        result.follow_up_tasks.map((t) => ({
          owner_id: task.owner_id,
          title: t.title.trim(),
          due_at: t.due_time ? `${today}T${t.due_time}:00` : null,
          goal_id: task.goal_id,
          status: "pending",
          source: "ai_suggested",
          approval_status: "pending",
        }))
      )
      .select();
    followUpCreated = Boolean(inserted.data && inserted.data.length > 0);
  }

  await db
    .from("task_checkins")
    .update({
      response_text: responseText,
      responded_at: new Date().toISOString(),
      ai_assessment: result.assessment,
      follow_up_created: followUpCreated,
    })
    .eq("id", checkin.id);

  return result;
}
