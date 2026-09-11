import { NextRequest, NextResponse } from "next/server";
import { getCurrentAppUser, createSupabaseAdminClient } from "@/lib/supabaseServer";

// Creates a self-imposed stake on one of the caller's own PERSONAL tasks.
// No AI Judge, no partner involvement — this is a private commitment
// device, not a real fine. The owner is the only one who can ever read
// these rows (see RLS policy on personal_stakes in
// supabase/migrations/0009_personal_mode.sql).
export async function POST(req: NextRequest) {
  const me = await getCurrentAppUser();
  if (!me) return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const taskId = typeof body?.task_id === "string" ? body.task_id : null;
  const amount = Number(body?.amount);
  if (!taskId) return NextResponse.json({ ok: false, error: "task_id is required" }, { status: 400 });
  if (!amount || amount <= 0) return NextResponse.json({ ok: false, error: "amount must be a positive number" }, { status: 400 });

  const db = createSupabaseAdminClient();
  if (!db) return NextResponse.json({ ok: false, error: "db_not_configured" }, { status: 503 });

  const { data: task } = await db.from("tasks").select("*").eq("id", taskId).maybeSingle();
  if (!task) return NextResponse.json({ ok: false, error: "task not found" }, { status: 404 });
  if (task.owner_id !== me.id) return NextResponse.json({ ok: false, error: "not your task" }, { status: 403 });
  if (task.visibility !== "personal") {
    return NextResponse.json({ ok: false, error: "stakes can only be set on personal tasks" }, { status: 400 });
  }

  const { data: stake, error } = await db
    .from("personal_stakes")
    .insert({ task_id: taskId, owner_id: me.id, amount })
    .select()
    .single();

  if (error || !stake) {
    return NextResponse.json({ ok: false, error: error?.message ?? "failed to create stake" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, stake });
}
