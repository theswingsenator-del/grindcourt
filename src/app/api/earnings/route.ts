import { NextRequest, NextResponse } from "next/server";
import { getCurrentAppUser, createSupabaseAdminClient } from "@/lib/supabaseServer";
import { notify } from "@/lib/notify";
import { formatUsd } from "@/lib/fines";

// POST /api/earnings — logs an earning against the $3K sprint. Body:
// {amount_usd, note?, task_id?}. Notifies the other partner so progress is
// visible team-wide.
export async function POST(req: NextRequest) {
  const me = await getCurrentAppUser();
  if (!me) return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const amount = Number(body?.amount_usd);
  if (!amount || amount <= 0) return NextResponse.json({ ok: false, error: "amount_usd must be > 0" }, { status: 400 });

  const note = typeof body?.note === "string" ? body.note.trim() || null : null;
  const taskId = typeof body?.task_id === "string" && body.task_id ? body.task_id : null;

  const db = createSupabaseAdminClient();
  if (!db) return NextResponse.json({ ok: false, error: "db_not_configured" }, { status: 503 });

  const { data: entry, error } = await db
    .from("earnings_log")
    .insert({ user_id: me.id, task_id: taskId, amount_usd: amount, note })
    .select()
    .single();

  if (error || !entry) {
    return NextResponse.json({ ok: false, error: error?.message ?? "failed to log earning" }, { status: 500 });
  }

  const { data: partner } = await db.from("app_users").select("*").neq("id", me.id).maybeSingle();
  if (partner) {
    await notify({
      userId: partner.id,
      type: "earning_logged",
      title: `${me.display_name} logged ${formatUsd(amount)}`,
      body: note ? `${formatUsd(amount)} — ${note}` : `${formatUsd(amount)} toward the sprint goal.`,
      relatedTaskId: taskId ?? undefined,
    });
  }

  return NextResponse.json({ ok: true, entry });
}
