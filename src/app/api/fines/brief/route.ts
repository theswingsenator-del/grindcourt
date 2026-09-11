import { NextRequest, NextResponse } from "next/server";
import { getCurrentAppUser, createSupabaseAdminClient } from "@/lib/supabaseServer";
import { judgeBrief } from "@/lib/judge";
import { notify } from "@/lib/notify";
import { formatNaira } from "@/lib/fines";

// Files a "Brief the Judge" — a free-form narrative explanation, available
// on ANY fine regardless of offense count (unlike Appeal). The Judge reads
// it holistically and may waive the fine outright, waive it and
// retroactively mark the related task done, or insist the fine stands.
export async function POST(req: NextRequest) {
  const me = await getCurrentAppUser();
  if (!me) return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const fineId = typeof body?.fine_id === "string" ? body.fine_id : null;
  const briefText = typeof body?.brief_text === "string" ? body.brief_text.trim() : "";
  if (!fineId || !briefText) {
    return NextResponse.json({ ok: false, error: "fine_id and brief_text are required" }, { status: 400 });
  }

  const db = createSupabaseAdminClient();
  if (!db) return NextResponse.json({ ok: false, error: "db_not_configured" }, { status: 503 });

  const { data: fine } = await db.from("fines").select("*").eq("id", fineId).single();
  if (!fine) return NextResponse.json({ ok: false, error: "fine not found" }, { status: 404 });
  if (fine.user_id !== me.id) {
    return NextResponse.json({ ok: false, error: "only the fined user can brief the Judge on this fine" }, { status: 403 });
  }
  if (fine.status !== "issued") {
    return NextResponse.json({ ok: false, error: `fine is already ${fine.status}, cannot brief` }, { status: 400 });
  }

  const { data: violation } = await db.from("violations").select("*").eq("id", fine.violation_id).single();
  if (!violation) return NextResponse.json({ ok: false, error: "violation not found" }, { status: 404 });

  let relatedTask: { id: string; title: string } | null = null;
  if (violation.task_id) {
    const { data: task } = await db.from("tasks").select("id,title").eq("id", violation.task_id).maybeSingle();
    if (task) relatedTask = { id: task.id, title: task.title };
  }

  const { count: priorCount } = await db
    .from("violations")
    .select("id", { count: "exact", head: true })
    .eq("user_id", me.id)
    .eq("type", violation.type)
    .neq("id", violation.id)
    .lt("detected_at", violation.detected_at);

  const result = await judgeBrief(violation, fine, relatedTask, briefText, priorCount ?? 0);

  const { data: brief } = await db
    .from("fine_briefs")
    .insert({
      fine_id: fineId,
      submitted_by: me.id,
      brief_text: briefText,
      ai_verdict: result.verdict,
      ai_reasoning: result.reasoning,
      decided_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (result.verdict === "waive" || result.verdict === "update_task") {
    await db.from("fines").update({ status: "waived" }).eq("id", fineId);
    await db.from("notifications").delete().eq("type", "police_nag").eq("related_fine_id", fineId);
  }
  if (result.verdict === "update_task" && relatedTask) {
    const { data: taskRow } = await db.from("tasks").select("status").eq("id", relatedTask.id).maybeSingle();
    if (taskRow && taskRow.status !== "done") {
      await db.from("tasks").update({ status: "done", completed_at: new Date().toISOString() }).eq("id", relatedTask.id);
    }
  }

  await notify({
    userId: me.id,
    type: "brief_judged",
    title:
      result.verdict === "waive"
        ? "Fine waived"
        : result.verdict === "update_task"
          ? "Fine waived — task updated"
          : "Brief rejected",
    body:
      result.verdict === "insist"
        ? `${result.reasoning} ${formatNaira(fine.amount)} still owed.`
        : result.reasoning,
    relatedFineId: fineId,
  });

  return NextResponse.json({ ok: true, brief, verdict: result.verdict, reasoning: result.reasoning });
}
