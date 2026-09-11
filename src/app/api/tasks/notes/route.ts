import { NextRequest, NextResponse } from "next/server";
import { getCurrentAppUser, createSupabaseAdminClient } from "@/lib/supabaseServer";
import { notify } from "@/lib/notify";

// POST — leave a progress note on a task. Only the owner or an approved
// collaborator may post. Notifies the other person(s) on the task.
export async function POST(req: NextRequest) {
  const me = await getCurrentAppUser();
  if (!me) return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const taskId = typeof body?.task_id === "string" ? body.task_id : null;
  const noteBody = typeof body?.body === "string" ? body.body.trim() : "";
  if (!taskId || !noteBody) {
    return NextResponse.json({ ok: false, error: "task_id and body are required" }, { status: 400 });
  }

  const db = createSupabaseAdminClient();
  if (!db) return NextResponse.json({ ok: false, error: "db_not_configured" }, { status: 503 });

  const { data: task } = await db.from("tasks").select("*").eq("id", taskId).single();
  if (!task) return NextResponse.json({ ok: false, error: "task not found" }, { status: 404 });

  const isOwner = task.owner_id === me.id;
  const { data: myCollab } = await db
    .from("task_collaborators")
    .select("*")
    .eq("task_id", taskId)
    .eq("user_id", me.id)
    .eq("status", "approved")
    .maybeSingle();

  if (!isOwner && !myCollab) {
    return NextResponse.json({ ok: false, error: "only the owner or an approved collaborator can post notes" }, { status: 403 });
  }

  const { data: note, error } = await db
    .from("task_notes")
    .insert({ task_id: taskId, user_id: me.id, body: noteBody })
    .select()
    .single();
  if (error || !note) {
    return NextResponse.json({ ok: false, error: error?.message ?? "failed to post note" }, { status: 500 });
  }

  if (isOwner) {
    const { data: approvedCollabs } = await db
      .from("task_collaborators")
      .select("*")
      .eq("task_id", taskId)
      .eq("status", "approved");
    for (const c of approvedCollabs ?? []) {
      await notify({
        userId: c.user_id,
        type: "task_note_posted",
        title: "New note",
        body: `${me.display_name} left a note on "${task.title}".`,
        relatedTaskId: task.id,
      });
    }
  } else {
    await notify({
      userId: task.owner_id,
      type: "task_note_posted",
      title: "New note",
      body: `${me.display_name} left a note on "${task.title}".`,
      relatedTaskId: task.id,
    });
  }

  return NextResponse.json({ ok: true, note });
}
