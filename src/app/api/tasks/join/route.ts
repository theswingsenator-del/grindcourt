import { NextRequest, NextResponse } from "next/server";
import { getCurrentAppUser, createSupabaseAdminClient } from "@/lib/supabaseServer";
import { notify } from "@/lib/notify";

// POST — request to join a task the other partner owns. Owner approving
// this means an even split of credit for the task.
export async function POST(req: NextRequest) {
  const me = await getCurrentAppUser();
  if (!me) return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const taskId = typeof body?.task_id === "string" ? body.task_id : null;
  if (!taskId) return NextResponse.json({ ok: false, error: "task_id is required" }, { status: 400 });

  const db = createSupabaseAdminClient();
  if (!db) return NextResponse.json({ ok: false, error: "db_not_configured" }, { status: 503 });

  const { data: task } = await db.from("tasks").select("*").eq("id", taskId).single();
  if (!task) return NextResponse.json({ ok: false, error: "task not found" }, { status: 404 });
  if (task.owner_id === me.id) {
    return NextResponse.json({ ok: false, error: "you already own this task" }, { status: 400 });
  }

  const { data: collaborator, error } = await db
    .from("task_collaborators")
    .insert({ task_id: taskId, user_id: me.id, status: "requested" })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ ok: false, error: error.message || "already requested" }, { status: 400 });
  }

  await notify({
    userId: task.owner_id,
    type: "task_join_requested",
    title: "Join request",
    body: `${me.display_name} wants to join your work order "${task.title}".`,
    relatedTaskId: task.id,
  });

  return NextResponse.json({ ok: true, collaborator });
}
