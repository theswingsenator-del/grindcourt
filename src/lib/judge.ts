// The Judge — a strict, neutral AI arbiter. Never favors either partner.
// Two jobs: evaluate a bid (counter-offer) against an issued fine, and
// evaluate an appeal (only reachable on a user's first offense of a type).

import { askAI } from "./ai";
import { Fine, Violation } from "./types";
import { formatNaira } from "./fines";

const JUDGE_SYSTEM_PROMPT = `You are the Judge inside GrindCourt, an accountability app between two business partners who fine each other real money for missed commitments.

Rules you must follow exactly:
- You are strictly neutral. You do not know or care which partner is "yours" — you rule on the facts given.
- You rule ONLY on the evidence provided in the prompt: the violation type, its severity, the user's history of this violation type, and the excuse/reason text given.
- Legitimate excuses (documented emergency, external system outage, family emergency, hospitalization) can justify acceptance or a reduced counter. Vague or generic excuses ("I was busy", "forgot", "lost track of time") do not.
- A user's Nth repeat of the same excuse wording, or a pattern of excuses for the same violation type, should be judged MORE harshly, not less — repetition signals the excuse is not genuine.
- You always return your verdict as strict JSON matching the schema given in the prompt. No markdown, no prose outside the JSON object.
- You are firm by design. This app exists because soft enforcement failed. Default to holding the fine unless the excuse is genuinely compelling.`;

export type JudgeBidVerdict = "accept" | "reject" | "counter";

export interface JudgeBidResult {
  verdict: JudgeBidVerdict;
  counter_amount: number | null;
  reasoning: string;
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

/**
 * Judges a bid (counter-offer) against an issued fine. Retries once on a
 * malformed response before falling back to a safe default (reject —
 * the fine stands as issued, nothing is silently forgiven on a parse
 * failure).
 */
export async function judgeFine(
  violation: Violation,
  fine: Fine,
  bidAmount: number,
  reasonText: string,
  priorOccurrencesOfType: number
): Promise<JudgeBidResult> {
  const userPrompt = `Violation type: ${violation.type}
Severity: ${violation.severity}
This is occurrence #${priorOccurrencesOfType} of this violation type for this user.
Fine issued: ${formatNaira(fine.amount)} (ladder rung ${fine.rung})
User's proposed counter-offer: ${formatNaira(bidAmount)}
User's stated reason: "${reasonText}"

Return strict JSON only, matching exactly this schema:
{"verdict": "accept" | "reject" | "counter", "counter_amount": number | null, "reasoning": "one or two sentences"}

- "accept": the proposed amount (${formatNaira(bidAmount)}) is fair, use it.
- "reject": the excuse doesn't hold up, the original fine (${formatNaira(fine.amount)}) stands.
- "counter": neither the original nor the proposal is right — set counter_amount to your number between the two.`;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = await askAI(JUDGE_SYSTEM_PROMPT, userPrompt);
      const parsed = extractJSON(raw) as Partial<JudgeBidResult>;
      if (
        parsed.verdict === "accept" ||
        parsed.verdict === "reject" ||
        parsed.verdict === "counter"
      ) {
        return {
          verdict: parsed.verdict,
          counter_amount:
            parsed.verdict === "counter" && typeof parsed.counter_amount === "number"
              ? parsed.counter_amount
              : null,
          reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning : "No reasoning provided.",
        };
      }
    } catch {
      // fall through to retry
    }
  }

  return {
    verdict: "reject",
    counter_amount: null,
    reasoning:
      "The Judge could not reach a clean verdict (AI response was malformed after retry). Defaulting to hold the original fine.",
  };
}

export interface JudgeAppealResult {
  verdict: "approved" | "denied";
  reasoning: string;
}

/**
 * Judges an appeal. Callers MUST have already verified this is the user's
 * FIRST offense of the violation type before invoking this — see
 * canFileAppeal() below.
 */
export async function judgeAppeal(
  violation: Violation,
  fine: Fine,
  reasonText: string
): Promise<JudgeAppealResult> {
  const userPrompt = `An appeal has been filed against a fine. This is confirmed to be the user's FIRST-EVER offense of this violation type, which is why an appeal is even allowed.

Violation type: ${violation.type}
Severity: ${violation.severity}
Fine: ${formatNaira(fine.amount)} (ladder rung ${fine.rung})
User's appeal reason: "${reasonText}"

Return strict JSON only, matching exactly this schema:
{"verdict": "approved" | "denied", "reasoning": "one or two sentences"}

Approve only if the reason is genuinely compelling for a first offense (documented emergency, system/technical failure outside the user's control, clear misunderstanding of what was required). Deny generic excuses even on a first offense — first offense earns the RIGHT to appeal, not an automatic pass.`;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = await askAI(JUDGE_SYSTEM_PROMPT, userPrompt);
      const parsed = extractJSON(raw) as Partial<JudgeAppealResult>;
      if (parsed.verdict === "approved" || parsed.verdict === "denied") {
        return {
          verdict: parsed.verdict,
          reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning : "No reasoning provided.",
        };
      }
    } catch {
      // fall through to retry
    }
  }

  return {
    verdict: "denied",
    reasoning:
      "The Judge could not reach a clean verdict (AI response was malformed after retry). Defaulting to deny — the fine stands.",
  };
}

export interface JudgeExtensionResult {
  verdict: "granted" | "denied";
  reasoning: string;
}

/**
 * Judges a "Request more time" extension request filed BEFORE a task's
 * deadline consequence lands (task still pending) — see
 * src/app/api/tasks/extend/route.ts. If granted, the caller moves due_at
 * to the requested value and no fine ever fires for the original deadline.
 * If denied, the original due date stands and normal task_overdue /
 * late_completion fine logic applies as usual. Same
 * retry-once-then-safe-fallback pattern as the rest of this file — a
 * malformed AI response falls back to "denied" (never silently grant more
 * time on an AI hiccup).
 */
export async function judgeExtensionRequest(
  task: { id: string; title: string },
  reasonText: string,
  originalDueAt: string,
  requestedDueAt: string
): Promise<JudgeExtensionResult> {
  const userPrompt = `A task owner is requesting more time on a deadline BEFORE it's missed — asking to move the due date instead of waiting for it to become a violation.

Task: "${task.title}"
Original due date: ${originalDueAt}
Requested new due date: ${requestedDueAt}
Reason given: "${reasonText}"

Return strict JSON only, matching exactly this schema:
{"verdict": "granted" | "denied", "reasoning": "one or two sentences"}

- "granted": the reason is genuinely legitimate — a real emergency, an external blocker outside the person's control, or a genuine scheduling conflict. If granted, no fine will ever be issued against the original deadline.
- "denied": the reason is vague or generic ("ran out of time", "got busy", "need more time") and doesn't hold up. The original due date stands, and normal lateness consequences apply as usual.

Same skepticism as the rest of your rulings — default to denying unless the reason is genuinely compelling.`;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = await askAI(JUDGE_SYSTEM_PROMPT, userPrompt);
      const parsed = extractJSON(raw) as Partial<JudgeExtensionResult>;
      if (parsed.verdict === "granted" || parsed.verdict === "denied") {
        return {
          verdict: parsed.verdict,
          reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning : "No reasoning provided.",
        };
      }
    } catch {
      // fall through to retry
    }
  }

  return {
    verdict: "denied",
    reasoning:
      "The Judge could not reach a clean verdict (AI response was malformed after retry). Defaulting to deny — the original due date stands.",
  };
}

/** First-offense check — appeals are ONLY allowed the first time a user
 * commits a given violation type. `priorViolationsOfSameType` should be
 * the count of violations of this type for this user, EXCLUDING the one
 * this fine is for. */
export function canFileAppeal(priorViolationsOfSameType: number): boolean {
  return priorViolationsOfSameType === 0;
}

export interface JudgeBriefResult {
  verdict: "waive" | "update_task" | "insist";
  reasoning: string;
}

/**
 * Judges a "Brief the Judge" submission — a free-form narrative account of
 * real work the record doesn't show, filed against ANY fine regardless of
 * offense count (unlike judgeAppeal, not gated to first offense). Same
 * retry-once-then-safe-fallback pattern as the rest of this file.
 *
 * `relatedTask` is null when the violation had no task_id (e.g. a
 * missed_log violation isn't task-bound) — in that case "update_task" is
 * not a valid choice, enforced both in the prompt and in validation below.
 */
export async function judgeBrief(
  violation: Violation,
  fine: Fine,
  relatedTask: { id: string; title: string } | null,
  briefText: string,
  priorOccurrencesOfType: number
): Promise<JudgeBriefResult> {
  const userPrompt = `A "Brief the Judge" has been filed against a fine — a free-form account of real work/progress that the system record doesn't reflect, submitted for you to weigh holistically. This is available regardless of offense count.

Violation type: ${violation.type}
Severity: ${violation.severity}
This is occurrence #${priorOccurrencesOfType} of this violation type for this user.
Fine issued: ${formatNaira(fine.amount)} (ladder rung ${fine.rung})
Related task: ${relatedTask ? `"${relatedTask.title}"` : "none — this violation is not tied to a specific task"}
User's brief: "${briefText}"

Return strict JSON only, matching exactly this schema:
{"verdict": "waive" | "update_task" | "insist", "reasoning": "one or two sentences"}

- "waive": if the brief's account of real work, taken as true, genuinely means this fine shouldn't stand — the substance of the commitment was actually met, just not reflected in the system.
- "update_task": same as "waive", but additionally the related task should be retroactively marked done because the brief makes clear the work genuinely got done. If no related task is given above, "update_task" is not a valid choice — only "waive" or "insist" are available in that case.
- "insist": the brief doesn't hold up — vague, unverifiable, or doesn't actually address the gap. The fine stands.

Be skeptical by default, same "soft enforcement failed, hold firm unless genuinely compelling" spirit as the rest of your rulings. A brief that's just a restated excuse without concrete detail should be met with "insist".`;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = await askAI(JUDGE_SYSTEM_PROMPT, userPrompt);
      const parsed = extractJSON(raw) as Partial<JudgeBriefResult>;
      if (
        (parsed.verdict === "waive" || parsed.verdict === "insist") ||
        (parsed.verdict === "update_task" && relatedTask !== null)
      ) {
        return {
          verdict: parsed.verdict,
          reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning : "No reasoning provided.",
        };
      }
    } catch {
      // fall through to retry
    }
  }

  return {
    verdict: "insist",
    reasoning:
      "The Judge could not reach a clean verdict (AI response was malformed after retry). Defaulting to hold the original fine.",
  };
}
