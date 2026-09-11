import { NextRequest, NextResponse } from "next/server";
import { getCurrentAppUser, createSupabaseAdminClient } from "@/lib/supabaseServer";
import { notify } from "@/lib/notify";

// POST — only the task owner may approve or deny a join request.
export async function POST(req: NextRequest) {
  const me = await getCurrentAppUser();
  if (!me) return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const taskId = typeof body?.task_id === "string" ? body.task_id : null;
  const collaboratorUserId = typeof body?.collaborator_user_id === "string" ? body.collaborator_user_id : null;
  const approve = body?.approve === true;
  if (!taskId || !collaboratorUserId) {
    return NextResponse.json({ ok: false, error: "task_id and collaborator_user_id are required" }, { status: 400 });
  }

  const db = createSupabaseAdminClient();
  if (!db) return NextResponse.json({ ok: false, error: "db_not_configured" }, { status: 503 });

  const { data: task } = await db.from("tasks").select("*").eq("id", taskId).single();
  if (!task) return NextResponse.json({ ok: false, error: "task not found" }, { status: 404 });
  if (task.owner_id !== me.id) {
    return NextResponse.json({ ok: false, error: "only the task owner can respond to join requests" }, { status: 403 });
  }

  const { data: collaborator } = await db
    .from("task_collaborators")
    .select("*")
    .eq("task_id", taskId)
    .eq("user_id", collaboratorUserId)
    .maybeSingle();
  if (!collaborator) return NextResponse.json({ ok: false, error: "join request not found" }, { status: 404 });

  if (approve) {
    await db.from("task_collaborators").update({ status: "approved" }).eq("id", collaborator.id);
    await notify({
      userId: collaboratorUserId,
      type: "task_join_approved",
      title: "Join request approved",
      body: `${me.display_name} approved you joining "${task.title}" — credit is now shared.`,
      relatedTaskId: task.id,
    });
  } else {
    await db.from("task_collaborators").delete().eq("id", collaborator.id);
    await notify({
      userId: collaboratorUserId,
      type: "task_join_denied",
      title: "Join request denied",
      body: `${me.display_name} denied your request to join "${task.title}".`,
      relatedTaskId: task.id,
    });
  }

  return NextResponse.json({ ok: true, approved: approve });
}
