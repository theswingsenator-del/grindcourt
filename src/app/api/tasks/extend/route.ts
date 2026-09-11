import { NextRequest, NextResponse } from "next/server";
import { getCurrentAppUser, createSupabaseAdminClient } from "@/lib/supabaseServer";
import { judgeExtensionRequest } from "@/lib/judge";
import { notify } from "@/lib/notify";

// Files a "Request more time" extension request against a still-pending
// task's deadline, before that deadline's consequence lands. If the Judge
// grants it, due_at moves to the requested value and NO fine ever fires
// for the original deadline. If denied, the original due_at stands and
// normal fine logic (task_overdue / late_completion, see lib/violations.ts
// and the PATCH handler in src/app/api/tasks/route.ts) applies as usual.
export async function POST(req: NextRequest) {
  const me = await getCurrentAppUser();
  if (!me) return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const taskId = typeof body?.task_id === "string" ? body.task_id : null;
  const reasonText = typeof body?.reason_text === "string" ? body.reason_text.trim() : "";
  const requestedDueAt = typeof body?.requested_due_at === "string" ? body.requested_due_at : "";
  if (!taskId || !reasonText || !requestedDueAt) {
    return NextResponse.json(
      { ok: false, error: "task_id, reason_text, and requested_due_at are required" },
      { status: 400 }
    );
  }

  const db = createSupabaseAdminClient();
  if (!db) return NextResponse.json({ ok: false, error: "db_not_configured" }, { status: 503 });

  const { data: task } = await db.from("tasks").select("*").eq("id", taskId).single();
  if (!task) return NextResponse.json({ ok: false, error: "task not found" }, { status: 404 });
  if (task.owner_id !== me.id) {
    return NextResponse.json({ ok: false, error: "only the task owner can request more time" }, { status: 403 });
  }
  if (task.status !== "pending") {
    return NextResponse.json({ ok: false, error: "task is no longer pending, cannot request more time" }, { status: 400 });
  }
  if (!task.due_at) {
    return NextResponse.json({ ok: false, error: "task has no due date to extend" }, { status: 400 });
  }

  const result = await judgeExtensionRequest(
    { id: task.id, title: task.title },
    reasonText,
    task.due_at,
    requestedDueAt
  );

  const { data: extension } = await db
    .from("task_extension_requests")
    .insert({
      task_id: taskId,
      requested_by: me.id,
      reason_text: reasonText,
      original_due_at: task.due_at,
      requested_due_at: requestedDueAt,
      ai_verdict: result.verdict,
      ai_reasoning: result.reasoning,
      decided_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (result.verdict === "granted") {
    await db.from("tasks").update({ due_at: requestedDueAt }).eq("id", taskId);
  }

  await notify({
    userId: me.id,
    type: "extension_decided",
    title: result.verdict === "granted" ? "More time granted" : "More time denied",
    body: result.reasoning,
    relatedTaskId: taskId,
  });

  return NextResponse.json({ ok: true, extension, verdict: result.verdict, reasoning: result.reasoning });
}
