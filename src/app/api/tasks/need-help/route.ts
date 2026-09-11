import { NextRequest, NextResponse } from "next/server";
import { getCurrentAppUser, createSupabaseAdminClient } from "@/lib/supabaseServer";
import { notify } from "@/lib/notify";

// POST — only the owner may toggle the "need help" flag on their task.
export async function POST(req: NextRequest) {
  const me = await getCurrentAppUser();
  if (!me) return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const taskId = typeof body?.task_id === "string" ? body.task_id : null;
  const needsHelp = body?.needs_help === true;
  if (!taskId) return NextResponse.json({ ok: false, error: "task_id is required" }, { status: 400 });

  const db = createSupabaseAdminClient();
  if (!db) return NextResponse.json({ ok: false, error: "db_not_configured" }, { status: 503 });

  const { data: task } = await db.from("tasks").select("*").eq("id", taskId).single();
  if (!task) return NextResponse.json({ ok: false, error: "task not found" }, { status: 404 });
  if (task.owner_id !== me.id) {
    return NextResponse.json({ ok: false, error: "only the task owner can flag need-help" }, { status: 403 });
  }

  await db.from("tasks").update({ needs_help: needsHelp }).eq("id", taskId);

  if (needsHelp) {
    const { data: partner } = await db.from("app_users").select("*").neq("id", me.id).maybeSingle();
    if (partner) {
      await notify({
        userId: partner.id,
        type: "task_needs_help",
        title: "Help flagged",
        body: `${me.display_name} flagged "${task.title}" — needs help.`,
        relatedTaskId: task.id,
      });
    }
  }

  return NextResponse.json({ ok: true, needs_help: needsHelp });
}
