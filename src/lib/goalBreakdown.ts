// "Break this down" — decomposes a big goal into milestones → weekly
// targets → daily tasks via askAI(), returning strict validated JSON the
// UI turns directly into task rows. Retries once on a parse/validation
// failure before surfacing an error to the caller.

import { askAI } from "./ai";

const SYSTEM_PROMPT = `You are a ruthless execution planner inside GrindCourt, an accountability app. Given a big goal and an optional target date, break it into a concrete, achievable plan.

Output STRICT JSON only — no markdown fences, no prose before or after — matching exactly this schema:

{
  "milestones": [
    {
      "title": "string, short milestone name",
      "weeks": [
        {
          "label": "string, e.g. Week 1",
          "target": "string, the concrete weekly target",
          "daily_tasks": [
            { "title": "string, short imperative task title", "description": "string, one sentence of what done looks like" }
          ]
        }
      ]
    }
  ]
}

Rules:
- 1-2 milestones. Each milestone has 1-2 weeks. Each week has 2-4 daily tasks.
- The total daily_tasks count across the ENTIRE breakdown (every week, every milestone, summed) must not exceed 10 — err toward fewer, sharper tasks over many small ones. This must stay small and digestible, never overwhelming.
- Tasks must be concrete and completable in a single day — no vague tasks like "work on it".
- Do not invent a target date if none was given — pace the plan reasonably (assume roughly 1-3 weeks total) instead.
- Output valid JSON matching the schema exactly. No trailing commas, no comments.`;

export interface BreakdownTask {
  title: string;
  description: string;
}

export interface BreakdownWeek {
  label: string;
  target: string;
  daily_tasks: BreakdownTask[];
}

export interface BreakdownMilestone {
  title: string;
  weeks: BreakdownWeek[];
}

export interface GoalBreakdown {
  milestones: BreakdownMilestone[];
}

function extractJSON(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced ? fenced[1] : trimmed;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("No JSON object found in AI response");
  return JSON.parse(raw.slice(start, end + 1));
}

function isValidBreakdown(value: unknown): value is GoalBreakdown {
  if (typeof value !== "object" || value === null) return false;
  const v = value as { milestones?: unknown };
  if (!Array.isArray(v.milestones) || v.milestones.length === 0) return false;
  return v.milestones.every((m: unknown) => {
    if (typeof m !== "object" || m === null) return false;
    const mm = m as { title?: unknown; weeks?: unknown };
    if (typeof mm.title !== "string" || !Array.isArray(mm.weeks) || mm.weeks.length === 0) return false;
    return mm.weeks.every((w: unknown) => {
      if (typeof w !== "object" || w === null) return false;
      const ww = w as { label?: unknown; target?: unknown; daily_tasks?: unknown };
      if (
        typeof ww.label !== "string" ||
        typeof ww.target !== "string" ||
        !Array.isArray(ww.daily_tasks) ||
        ww.daily_tasks.length === 0
      )
        return false;
      return ww.daily_tasks.every((t: unknown) => {
        if (typeof t !== "object" || t === null) return false;
        const tt = t as { title?: unknown; description?: unknown };
        return typeof tt.title === "string" && typeof tt.description === "string";
      });
    });
  });
}

export class GoalBreakdownError extends Error {}

// Safety net: the prompt instructs the AI to cap total daily_tasks at 10,
// but prompt compliance isn't guaranteed. If it still comes back bloated
// (the incident that prompted this: one goal produced 24 tasks and
// cluttered the docket), truncate to the first 10 tasks in plan order
// rather than trusting the AI's count.
const TARGET_MAX_TOTAL_TASKS = 10;
const HARD_CAP_TOTAL_TASKS = 12;

function totalTaskCount(breakdown: GoalBreakdown): number {
  return breakdown.milestones.reduce(
    (sum, m) => sum + m.weeks.reduce((weekSum, w) => weekSum + w.daily_tasks.length, 0),
    0
  );
}

function truncateToMaxTasks(breakdown: GoalBreakdown, max: number): GoalBreakdown {
  let remaining = max;
  return {
    milestones: breakdown.milestones.map((m) => ({
      ...m,
      weeks: m.weeks.map((w) => {
        if (remaining <= 0) return { ...w, daily_tasks: [] };
        const kept = w.daily_tasks.slice(0, remaining);
        remaining -= kept.length;
        return { ...w, daily_tasks: kept };
      }),
    })),
  };
}

/**
 * Calls the AI to decompose a goal, validates the strict JSON schema, and
 * retries once on failure. Throws GoalBreakdownError if both attempts fail
 * — callers should surface a clear "try again" message rather than
 * inventing a fallback plan (a bad auto-generated plan is worse than none).
 */
export async function breakdownGoal(title: string, description: string | null, targetDate: string | null): Promise<GoalBreakdown> {
  const userPrompt = `Goal: ${title}
${description ? `Details: ${description}` : ""}
${targetDate ? `Target date: ${targetDate}` : "No target date given — pace it yourself."}

Break this down now. JSON only.`;

  let lastError: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = await askAI(SYSTEM_PROMPT, userPrompt);
      const parsed = extractJSON(raw);
      if (isValidBreakdown(parsed)) {
        return totalTaskCount(parsed) > HARD_CAP_TOTAL_TASKS ? truncateToMaxTasks(parsed, TARGET_MAX_TOTAL_TASKS) : parsed;
      }
      lastError = new Error("AI response did not match the required schema");
    } catch (err) {
      lastError = err;
    }
  }
  throw new GoalBreakdownError(
    `Could not generate a valid goal breakdown after 2 attempts: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`
  );
}
