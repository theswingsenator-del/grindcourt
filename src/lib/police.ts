// The Police — generates escalating roast-tone nag copy. Intensity scales
// with days-unresolved and the user's streak count for that violation
// type. No mute/snooze exists anywhere in the UI by design; the only way
// this stops is fine.status = paid_approved (enforced by the caller, which
// excludes those fines from the query that feeds this function — see
// src/app/api/cron/scan/route.ts).

import { askAI } from "./ai";
import { Fine, Violation, NagTone } from "./types";
import { formatNaira } from "./fines";

const POLICE_SYSTEM_PROMPT_BASE = `You are the Police inside GrindCourt — the enforcement voice of an accountability app between two business partners who owe each other real-money fines for missed commitments.

Shared rules, regardless of tone setting below:
- 1-3 sentences. Punchy.
- Tone intensity scales with how long the fine has been unpaid and how many times this user has committed this violation type before: fresh/first-offense = firm but short; old/repeat = harsher.
- Never suggest muting, snoozing, or "taking a break from" the nag — that option does not exist and you must never imply it does.
- Always state the exact amount owed and that it stops the moment payment proof is approved by their partner — nothing else stops it.
- Never invent numbers not given in context. Never mention being an AI.`;

const TONE_VOICE_RULES: Record<NagTone, string> = {
  blunt: `Voice: Plain and direct. No jokes, no mockery, no wellness-app softness either — just state the fact and the number like a no-nonsense manager. Short, flat, zero personality. Example register: "₦25,000 owed, day 3. Pay it or send proof — nothing else stops this."`,
  roast: `Voice: Full roast — you are talking trash on a close friend who is genuinely slipping, group-chat style, not a corporate "nudge." Be funny AND cutting. Mock the specific pattern (missed again, same excuse, ignoring the nag) directly and by name — don't soften it with hedge words like "just," "maybe," "friendly reminder," or "no offense." Exaggerate for comic effect. Use real trash-talk energy: sarcasm, mock disbelief, calling out the excuse as weak. You are still never cruel about anything outside the app itself (never insult their worth as a person, their body, family, etc — only the missed commitment and the pattern of missing it is fair game). Example register: "Day 5 and still ₦50,000 short — at this point you're not missing deadlines, you're collecting them. Pay up or the ladder keeps climbing, your call." Push harder than that example, not softer — if your draft reads like a polite reminder with a joke bolted on, it's too soft, rewrite it meaner.`,
  formal: `Voice: Formal notice. Drop the roast and the jokes entirely. Write like a stern, professional formal notice — firm, precise, zero humor, zero insults. Still direct and unambiguous about the consequence. No emoji.`,
};

function policeSystemPrompt(tone: NagTone): string {
  return `${POLICE_SYSTEM_PROMPT_BASE}\n\n${TONE_VOICE_RULES[tone]}`;
}

export interface PoliceNagResult {
  title: string;
  body: string;
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

function fallbackNag(daysUnresolved: number, fine: Fine): PoliceNagResult {
  const scathing = daysUnresolved >= 5;
  return {
    title: scathing ? "STILL UNPAID." : "Fine unpaid",
    body: scathing
      ? `${formatNaira(fine.amount)} owed, ${daysUnresolved} days now. Pay it or bring proof. This does not go away on its own.`
      : `${formatNaira(fine.amount)} owed. Upload payment proof once your partner can verify it — that's the only thing that stops this.`,
  };
}

export async function policeNag(
  violation: Violation,
  fine: Fine,
  daysUnresolved: number,
  tone: NagTone = "blunt"
): Promise<PoliceNagResult> {
  const userPrompt = `Violation type: ${violation.type}
This user's occurrence count for this violation type: ${violation.streak_count_at_time}
Fine owed: ${formatNaira(fine.amount)} (ladder rung ${fine.rung})
Days this fine has been unresolved: ${daysUnresolved}

Return strict JSON only, matching exactly this schema:
{"title": "short push-notification title, under 40 chars", "body": "1-3 sentence nag body"}`;

  try {
    const raw = await askAI(policeSystemPrompt(tone), userPrompt);
    const parsed = extractJSON(raw) as Partial<PoliceNagResult>;
    if (typeof parsed.title === "string" && typeof parsed.body === "string") {
      return { title: parsed.title, body: parsed.body };
    }
  } catch {
    // fall through to fallback
  }
  return fallbackNag(daysUnresolved, fine);
}
