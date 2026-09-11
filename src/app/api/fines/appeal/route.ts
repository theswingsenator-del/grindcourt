import { NextRequest, NextResponse } from "next/server";
import { getCurrentAppUser, createSupabaseAdminClient } from "@/lib/supabaseServer";
import { judgeAppeal, canFileAppeal } from "@/lib/judge";
import { notify } from "@/lib/notify";
import { formatNaira } from "@/lib/fines";

// Files an appeal — only permitted if this is the user's FIRST offense of
// the violation type. Checked server-side against violation history
// (never trust a client-supplied "is this my first" flag).
export async function POST(req: NextRequest) {
  const me = await getCurrentAppUser();
  if (!me) return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const fineId = typeof body?.fine_id === "string" ? body.fine_id : null;
  const reasonText = typeof body?.reason_text === "string" ? body.reason_text.trim() : "";
  if (!fineId || !reasonText) {
    return NextResponse.json({ ok: false, error: "fine_id and reason_text are required" }, { status: 400 });
  }

  const db = createSupabaseAdminClient();
  if (!db) return NextResponse.json({ ok: false, error: "db_not_configured" }, { status: 503 });

  const { data: fine } = await db.from("fines").select("*").eq("id", fineId).single();
  if (!fine) return NextResponse.json({ ok: false, error: "fine not found" }, { status: 404 });
  if (fine.user_id !== me.id) {
    return NextResponse.json({ ok: false, error: "only the fined user can appeal this fine" }, { status: 403 });
  }
  if (fine.status !== "issued") {
    return NextResponse.json({ ok: false, error: `fine is already ${fine.status}, cannot appeal` }, { status: 400 });
  }

  const { data: violation } = await db.from("violations").select("*").eq("id", fine.violation_id).single();
  if (!violation) return NextResponse.json({ ok: false, error: "violation not found" }, { status: 404 });

  if (violation.appeal_forfeited) {
    return NextResponse.json(
      { ok: false, error: "appeal forfeited — this violation followed an ignored Predictor nudge" },
      { status: 403 }
    );
  }

  const { count: priorCount } = await db
    .from("violations")
    .select("id", { count: "exact", head: true })
    .eq("user_id", me.id)
    .eq("type", violation.type)
    .neq("id", violation.id)
    .lt("detected_at", violation.detected_at);

  if (!canFileAppeal(priorCount ?? 0)) {
    return NextResponse.json(
      { ok: false, error: "appeals are only allowed on your first offense of this violation type" },
      { status: 403 }
    );
  }

  await db.from("fines").update({ status: "appealed" }).eq("id", fineId);

  const result = await judgeAppeal(violation, fine, reasonText);

  const { data: appeal } = await db
    .from("appeals")
    .insert({
      fine_id: fineId,
      reason_text: reasonText,
      ai_verdict: result.verdict,
      ai_reasoning: result.reasoning,
      decided_at: new Date().toISOString(),
    })
    .select()
    .single();

  const finalStatus = result.verdict === "approved" ? "accepted" : "appeal_denied";
  await db.from("fines").update({ status: finalStatus }).eq("id", fineId);
  if (result.verdict === "approved") {
    await db.from("fines").update({ amount: 0 }).eq("id", fineId);
  }
  if (finalStatus === "accepted") {
    await db.from("notifications").delete().eq("type", "police_nag").eq("related_fine_id", fineId);
  }

  await notify({
    userId: me.id,
    type: "appeal_decided",
    title: result.verdict === "approved" ? "Appeal approved" : "Appeal denied",
    body:
      result.verdict === "approved"
        ? `Appeal approved — fine waived. ${result.reasoning}`
        : `Appeal denied — ${formatNaira(fine.amount)} still owed. ${result.reasoning}`,
    relatedFineId: fineId,
  });

  return NextResponse.json({ ok: true, appeal, verdict: result.verdict, reasoning: result.reasoning });
}
