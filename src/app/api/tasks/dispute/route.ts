import { NextRequest, NextResponse } from "next/server";
import { getCurrentAppUser, createSupabaseAdminClient } from "@/lib/supabaseServer";
import { askAI } from "@/lib/ai";
import { issueFine } from "@/lib/issueFine";
import { notify } from "@/lib/notify";

const REVIEW_SYSTEM_PROMPT = `You are reviewing a dispute inside GrindCourt, an accountability app. One partner marked a task done; the other partner is disputing that it was genuinely completed. You must decide whether the dispute is UPHELD (the task was not genuinely done — this is a false completion) or OVERRULED (the task was genuinely done, the dispute is rejected).

Rules:
- Be strictly neutral — you do not favor either partner.
- Judge only on the task details and the dispute reason given. Absent stronger evidence either way, prefer OVERRULE (the person who did the work gets benefit of the doubt) unless the dispute reason describes something concrete and specific (e.g. "the deliverable literally doesn't exist", "you sent me the same file from last week") rather than a vague accusation.
- Output strict JSON only: {"verdict": "uphold" | "overrule", "reasoning": "one or two sentences"}`;

function extractJSON(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced ? fenced[1] : trimmed;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("No JSON object found");
  return JSON.parse(raw.slice(start, end + 1));
}

// A partner disputes a task the other marked "done". The AI reviews the
// task details against the dispute reason; if upheld, a false_complete
// violation + fine is issued against the task owner.
export async function POST(req: NextRequest) {
  const me = await getCurrentAppUser();
  if (!me) return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const taskId = typeof body?.task_id === "string" ? body.task_id : null;
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  if (!taskId || !reason) {
    return NextResponse.json({ ok: false, error: "task_id and reason are required" }, { status: 400 });
  }

  const db = createSupabaseAdminClient();
  if (!db) return NextResponse.json({ ok: false, error: "db_not_configured" }, { status: 503 });

  const { data: task } = await db.from("tasks").select("*").eq("id", taskId).single();
  if (!task) return NextResponse.json({ ok: false, error: "task not found" }, { status: 404 });
  if (task.status !== "done") {
    return NextResponse.json({ ok: false, error: "only completed tasks can be disputed" }, { status: 400 });
  }
  if (task.owner_id === me.id) {
    return NextResponse.json({ ok: false, error: "cannot dispute your own task" }, { status: 400 });
  }

  await db
    .from("tasks")
    .update({ is_disputed: true, disputed_by: me.id, dispute_resolved: false })
    .eq("id", taskId);

  let verdict: "uphold" | "overrule" = "overrule";
  let reasoning = "Review failed to reach a clean verdict; dispute overruled by default.";
  try {
    const raw = await askAI(
      REVIEW_SYSTEM_PROMPT,
      `Task title: ${task.title}\nTask description: ${task.description ?? "(none)"}\nCompleted at: ${task.completed_at}\nDispute reason from partner: "${reason}"\n\nJSON only.`
    );
    const parsed = extractJSON(raw) as { verdict?: string; reasoning?: string };
    if (parsed.verdict === "uphold" || parsed.verdict === "overrule") {
      verdict = parsed.verdict;
      reasoning = typeof parsed.reasoning === "string" ? parsed.reasoning : reasoning;
    }
  } catch {
    // keep default overrule-on-failure — issuing a fine on an AI hiccup is worse than not
  }

  await db.from("tasks").update({ dispute_resolved: true }).eq("id", taskId);

  if (verdict === "uphold") {
    const result = await issueFine(
      task.owner_id,
      "false_complete",
      task.id,
      `Dispute upheld: "${task.title}" was marked done but disputed by partner. AI review: ${reasoning}`
    );
    await notify({
      userId: me.id,
      type: "dispute_resolved",
      title: "Dispute upheld",
      body: `Your dispute on "${task.title}" was upheld. ${reasoning}`,
      relatedTaskId: task.id,
    });
    return NextResponse.json({ ok: true, verdict, reasoning, violation: result?.violation, fine: result?.fine });
  }

  await db.from("tasks").update({ is_disputed: false }).eq("id", taskId);
  await notify({
    userId: me.id,
    type: "dispute_resolved",
    title: "Dispute overruled",
    body: `Your dispute on "${task.title}" was overruled. ${reasoning}`,
    relatedTaskId: task.id,
  });
  await notify({
    userId: task.owner_id,
    type: "dispute_resolved",
    title: "Dispute overruled in your favor",
    body: `A dispute on "${task.title}" was overruled. ${reasoning}`,
    relatedTaskId: task.id,
  });

  return NextResponse.json({ ok: true, verdict, reasoning });
}
