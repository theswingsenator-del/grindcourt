// The Narrator — a weekly AI-written recap ("Founders' Update"). Reads like
// a real update you'd send an investor: warm but factual, references
// specific events by name, not a stats dump. Unlike Judge/Police/Board,
// this call returns prose directly — no JSON schema.

import { SupabaseClient } from "@supabase/supabase-js";
import { askAI } from "./ai";
import { formatNaira } from "./fines";
import { getTreasuryBalance } from "./treasury";
import { AppUser } from "./types";

const NARRATOR_SYSTEM_PROMPT = `You are the Narrator inside GrindCourt, an accountability app between two business partners. Once a week you write a "Founders' Update" — a short recap that reads like a real update sent to an investor.

Voice rules:
- Warm but factual. Reference specific real events by name (task titles, violation types, amounts) — never generic praise or vague filler.
- Written for BOTH partners as the audience — address them together, not as "you" singular.
- 2-4 short paragraphs.
- Sign off simply (e.g. a short closing line — no fake signature block, no "Best regards, The Narrator").
- If the week had little activity, say so plainly rather than padding — honesty over hype.
- Never invent events, numbers, or names not given in the data below. Return plain prose only — no JSON, no markdown headers.`;

export async function generateWeeklyUpdate(db: SupabaseClient, now: Date = new Date()): Promise<string> {
  const sevenDaysAgo = new Date(now);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const sinceISO = sevenDaysAgo.toISOString();

  const [{ data: users }, { data: tasks }, { data: violations }, { data: fines }, { data: collaborators }] =
    await Promise.all([
      db.from("app_users").select("*"),
      db.from("tasks").select("*").eq("status", "done").gte("completed_at", sinceISO),
      db.from("violations").select("*").gte("detected_at", sinceISO),
      db.from("fines").select("*").gte("created_at", sinceISO),
      db.from("task_collaborators").select("*").eq("status", "approved"),
    ]);

  const usersList = (users ?? []) as AppUser[];
  const userName = (id: string) => usersList.find((u) => u.id === id)?.display_name ?? "a partner";

  const balance = await getTreasuryBalance(db);

  const tasksByUser = usersList.map((u) => {
    const done = (tasks ?? []).filter((t: { owner_id: string; title: string }) => t.owner_id === u.id);
    return `${u.display_name}: ${done.length} task(s) completed — ${
      done.length > 0 ? done.map((t: { title: string }) => `"${t.title}"`).join(", ") : "none"
    }`;
  });

  const violationLines = (violations ?? []).map((v: { id: string; type: string; user_id: string }) => {
    const fine = (fines ?? []).find((f: { violation_id: string }) => f.violation_id === v.id);
    const amount = fine ? formatNaira((fine as { amount: number }).amount) : "amount pending";
    return `${userName(v.user_id)}: ${v.type.replace(/_/g, " ")} (${amount})`;
  });

  const collaborationLines = (collaborators ?? []).map(
    (c: { task_id: string; user_id: string }) => `${userName(c.user_id)} joined a task as a collaborator (task ${c.task_id})`
  );

  const userPrompt = `Trailing 7 days of GrindCourt activity (${sevenDaysAgo.toDateString()} to ${now.toDateString()}):

Tasks completed:
${tasksByUser.join("\n")}

Violations / fines issued this week:
${violationLines.length > 0 ? violationLines.join("\n") : "None."}

Joint work orders (collaboration) this week:
${collaborationLines.length > 0 ? collaborationLines.join("\n") : "None."}

Current treasury balance: ${formatNaira(balance)}

Write the Founders' Update now. Plain prose, 2-4 short paragraphs, no markdown.`;

  try {
    const raw = await askAI(NARRATOR_SYSTEM_PROMPT, userPrompt);
    const text = raw.trim();
    if (text.length > 0) return text;
  } catch {
    // fall through to fallback
  }

  const totalDone = (tasks ?? []).length;
  return `This week: ${totalDone} task(s) completed across both dockets, ${
    (violations ?? []).length
  } violation(s) logged, and the treasury sits at ${formatNaira(balance)}. (The Narrator couldn't reach a full write-up this week — here's the short version instead.)`;
}
