// War Chest (treasury) — fines paid don't vanish, they fund real line items.
// The Board (an AI role, neutral capital-allocation voice, same family as
// the Judge) proposes ONE initiative at a time. Either partner can plead
// for a different priority; the Board can hold or switch its proposal.

import { SupabaseClient } from "@supabase/supabase-js";
import { askAI } from "./ai";
import { formatNaira } from "./fines";
import { WarChestProject, WarChestProposal } from "./types";

const BOARD_SYSTEM_PROMPT = `You are the Board inside GrindCourt, an accountability app between two business partners who fund shared initiatives from real-money fines they pay each other.

Rules you must follow exactly:
- You are strictly neutral capital allocation, not punishment — same firm, no-nonsense voice family as the Judge, but focused entirely on the fastest path to real value given current momentum.
- You reason ONLY over the un-funded projects and the current treasury balance given in the prompt.
- Prefer the project that unlocks the most value soonest given the balance and cost — cheaper achievable wins over expensive distant ones, unless a more expensive item is clearly the higher-leverage move.
- You always return your verdict as strict JSON matching the schema given in the prompt. No markdown, no prose outside the JSON object.
- Keep reasoning to 1-2 sentences.`;

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
 * Current treasury balance: sum of paid_approved fines, minus the cost of
 * every project already marked funded. Never assumed non-negative even
 * though it shouldn't happen in practice.
 */
export async function getTreasuryBalance(db: SupabaseClient): Promise<number> {
  const [{ data: fines }, { data: projects }] = await Promise.all([
    db.from("fines").select("amount").eq("status", "paid_approved"),
    db.from("war_chest_projects").select("cost_naira").eq("status", "funded"),
  ]);
  const paid = (fines ?? []).reduce((sum, f: { amount: number }) => sum + Number(f.amount), 0);
  const funded = (projects ?? []).reduce((sum, p: { cost_naira: number }) => sum + Number(p.cost_naira), 0);
  return paid - funded;
}

/**
 * Picks the next initiative to propose, if there isn't already an active
 * proposal. Retries once on a malformed AI response before falling back to
 * a safe default (propose the cheapest un-funded project — never blocks
 * progress on an AI hiccup).
 */
export async function proposeNextInitiative(db: SupabaseClient): Promise<WarChestProposal | null> {
  const { data: activeProposal } = await db
    .from("war_chest_proposals")
    .select("*")
    .eq("status", "active")
    .maybeSingle();
  if (activeProposal) return null;

  const { data: projects } = await db
    .from("war_chest_projects")
    .select("*")
    .neq("status", "funded");
  const unfunded = (projects ?? []) as WarChestProject[];

  // Nothing left in the seeded wishlist — the Board generates a new
  // initiative from scratch, grounded in real current goals/tasks, rather
  // than proposing from a fixed list forever.
  if (unfunded.length === 0) {
    return suggestAndProposeNewInitiative(db);
  }

  const balance = await getTreasuryBalance(db);

  // "Ads Spend" always goes first — it's the fastest-leverage seeded item
  // and shouldn't be left to AI discretion to reorder.
  const adsSpend = unfunded.find((p) => p.source === "seeded" && p.name === "Ads Spend");
  let chosen: { project_id: string; reasoning: string };

  if (adsSpend) {
    chosen = {
      project_id: adsSpend.id,
      reasoning: "First priority — fastest path to compounding return while the treasury is still building.",
    };
  } else {
    // Past Ads Spend: let the Board reason about which remaining item fits
    // best given what's actually being worked on right now.
    const { data: goals } = await db.from("goals").select("title").limit(10);
    const { data: tasks } = await db.from("tasks").select("title,status").order("created_at", { ascending: false }).limit(15);
    const goalTitles = (goals ?? []).map((g: { title: string }) => g.title);
    const taskTitles = (tasks ?? []).map((t: { title: string; status: string }) => `${t.title} (${t.status})`);

    const userPrompt = `Current treasury balance: ${formatNaira(balance)}

Un-funded projects available to propose:
${unfunded.map((p) => `- id: ${p.id} | "${p.name}" | cost ${formatNaira(p.cost_naira)}`).join("\n")}

Current goals in play:
${goalTitles.length > 0 ? goalTitles.map((t) => `- ${t}`).join("\n") : "(none logged yet)"}

Recent tasks/work:
${taskTitles.length > 0 ? taskTitles.map((t) => `- ${t}`).join("\n") : "(none logged yet)"}

Pick whichever un-funded project is most relevant to the actual work in play above — not just the cheapest.

Return strict JSON only, matching exactly this schema:
{"project_id": "the id of the project you propose next", "reasoning": "one or two sentences, referencing the specific goal/task that makes this the right pick now"}`;

    let picked: { project_id: string; reasoning: string } | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const raw = await askAI(BOARD_SYSTEM_PROMPT, userPrompt);
        const parsed = extractJSON(raw) as Partial<{ project_id: string; reasoning: string }>;
        if (typeof parsed.project_id === "string" && unfunded.some((p) => p.id === parsed.project_id)) {
          picked = {
            project_id: parsed.project_id,
            reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning : "Next in line for funding.",
          };
          break;
        }
      } catch {
        // fall through to retry
      }
    }

    chosen = picked ?? {
      project_id: [...unfunded].sort((a, b) => a.cost_naira - b.cost_naira)[0].id,
      reasoning: "The Board defaulted to the cheapest un-funded item after a proposal reasoning failure.",
    };
  }

  const { data: proposal, error } = await db
    .from("war_chest_proposals")
    .insert({ project_id: chosen.project_id, ai_reasoning: chosen.reasoning, status: "active" })
    .select()
    .single();
  if (error || !proposal) return null;

  await db.from("war_chest_projects").update({ status: "proposed" }).eq("id", chosen.project_id);

  return proposal as WarChestProposal;
}

/**
 * Called once every seeded project has been funded. Generates a brand new
 * initiative grounded in real current goals/tasks (not a generic guess),
 * inserts it as an ai_suggested project, and immediately proposes it.
 */
async function suggestAndProposeNewInitiative(db: SupabaseClient): Promise<WarChestProposal | null> {
  const { data: fundedProjects } = await db.from("war_chest_projects").select("name,cost_naira").eq("status", "funded");
  const { data: goals } = await db.from("goals").select("title").limit(10);
  const { data: tasks } = await db.from("tasks").select("title,status").order("created_at", { ascending: false }).limit(15);
  const balance = await getTreasuryBalance(db);

  const fundedNames = (fundedProjects ?? []).map((p: { name: string }) => p.name);
  const goalTitles = (goals ?? []).map((g: { title: string }) => g.title);
  const taskTitles = (tasks ?? []).map((t: { title: string; status: string }) => `${t.title} (${t.status})`);

  const userPrompt = `Every previously funded initiative has now been paid for: ${fundedNames.join(", ") || "(none yet)"}.
Current treasury balance: ${formatNaira(balance)}

Current goals in play:
${goalTitles.length > 0 ? goalTitles.map((t) => `- ${t}`).join("\n") : "(none logged yet)"}

Recent tasks/work:
${taskTitles.length > 0 ? taskTitles.map((t) => `- ${t}`).join("\n") : "(none logged yet)"}

Propose ONE brand new initiative worth funding next — something concrete and real, grounded in the actual goals/tasks above, not generic. Estimate a realistic cost in Naira.

Return strict JSON only, matching exactly this schema:
{"name": "short concrete initiative name", "cost_naira": number, "reasoning": "one or two sentences, referencing the specific goal/task that justifies this"}`;

  let suggestion: { name: string; cost_naira: number; reasoning: string } | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = await askAI(BOARD_SYSTEM_PROMPT, userPrompt);
      const parsed = extractJSON(raw) as Partial<{ name: string; cost_naira: number; reasoning: string }>;
      if (typeof parsed.name === "string" && typeof parsed.cost_naira === "number" && parsed.cost_naira > 0) {
        suggestion = {
          name: parsed.name,
          cost_naira: parsed.cost_naira,
          reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning : "Newly proposed by the Board.",
        };
        break;
      }
    } catch {
      // fall through to retry
    }
  }

  if (!suggestion) return null; // don't invent a fallback project — better to wait for a clean AI response next scan

  const { data: newProject, error: projErr } = await db
    .from("war_chest_projects")
    .insert({ name: suggestion.name, cost_naira: suggestion.cost_naira, status: "seeded", source: "ai_suggested" })
    .select()
    .single();
  if (projErr || !newProject) return null;

  const { data: proposal, error } = await db
    .from("war_chest_proposals")
    .insert({ project_id: newProject.id, ai_reasoning: suggestion.reasoning, status: "active" })
    .select()
    .single();
  if (error || !proposal) return null;

  await db.from("war_chest_projects").update({ status: "proposed" }).eq("id", newProject.id);

  return proposal as WarChestProposal;
}

export interface EvaluatePleaResult {
  switched: boolean;
  ai_response: string;
}

/**
 * Evaluates a plea against the active proposal: switch to a different
 * un-funded project, or hold. Retries once, then falls back to holding
 * (never silently switches on a malformed response).
 */
export async function evaluatePlea(
  db: SupabaseClient,
  proposal: WarChestProposal,
  reasonText: string
): Promise<EvaluatePleaResult> {
  const { data: currentProject } = await db
    .from("war_chest_projects")
    .select("*")
    .eq("id", proposal.project_id)
    .single();

  const { data: projects } = await db.from("war_chest_projects").select("*").neq("status", "funded");
  const unfunded = ((projects ?? []) as WarChestProject[]).filter((p) => p.id !== proposal.project_id);

  const balance = await getTreasuryBalance(db);

  const userPrompt = `Current treasury balance: ${formatNaira(balance)}
Currently proposed project: "${currentProject?.name ?? "unknown"}" (id: ${proposal.project_id}), cost ${formatNaira(
    currentProject?.cost_naira ?? 0
  )}
Board's original reasoning for this proposal: "${proposal.ai_reasoning ?? "(none recorded)"}"

A partner has filed a plea for a different priority:
"${reasonText}"

Other un-funded projects available to switch to (if the plea is compelling and names/matches one of these):
${unfunded.length > 0 ? unfunded.map((p) => `- id: ${p.id} | "${p.name}" | cost ${formatNaira(p.cost_naira)}`).join("\n") : "(none — only the current project is un-funded)"}

Return strict JSON only, matching exactly this schema:
{"switch": true | false, "new_project_id": "id of the project to switch to, or null if switch is false", "response": "one or two sentences addressed to the partner explaining the decision"}

Only switch if the plea makes a genuinely stronger case (real urgency, a clear reason the current pick is not the highest-leverage move right now) and names/matches an available project. Hold otherwise.`;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = await askAI(BOARD_SYSTEM_PROMPT, userPrompt);
      const parsed = extractJSON(raw) as Partial<{ switch: boolean; new_project_id: string | null; response: string }>;
      if (typeof parsed.switch === "boolean" && typeof parsed.response === "string") {
        if (parsed.switch && typeof parsed.new_project_id === "string" && unfunded.some((p) => p.id === parsed.new_project_id)) {
          await db.from("war_chest_proposals").update({ status: "superseded" }).eq("id", proposal.id);
          await db.from("war_chest_projects").update({ status: "seeded" }).eq("id", proposal.project_id);
          await db.from("war_chest_proposals").insert({
            project_id: parsed.new_project_id,
            ai_reasoning: parsed.response,
            status: "active",
          });
          await db.from("war_chest_projects").update({ status: "proposed" }).eq("id", parsed.new_project_id);
          return { switched: true, ai_response: parsed.response };
        }
        return { switched: false, ai_response: parsed.response };
      }
    } catch {
      // fall through to retry
    }
  }

  return {
    switched: false,
    ai_response:
      "The Board could not reach a clean decision on this plea (AI response was malformed after retry). Holding the current proposal.",
  };
}
