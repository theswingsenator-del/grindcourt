import { NextRequest, NextResponse } from "next/server";
import { getCurrentAppUser, createSupabaseAdminClient } from "@/lib/supabaseServer";
import { judgeFine } from "@/lib/judge";
import { notify } from "@/lib/notify";
import { formatNaira } from "@/lib/fines";

// Submits a bid (counter-offer) against an issued fine, then immediately
// judges it via the AI and resolves the fine's status accordingly.
export async function POST(req: NextRequest) {
  const me = await getCurrentAppUser();
  if (!me) return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const fineId = typeof body?.fine_id === "string" ? body.fine_id : null;
  const proposedAmount = Number(body?.proposed_amount);
  const reasonText = typeof body?.reason_text === "string" ? body.reason_text.trim() : "";

  if (!fineId || !Number.isFinite(proposedAmount) || proposedAmount <= 0 || !reasonText) {
    return NextResponse.json(
      { ok: false, error: "fine_id, proposed_amount (>0), and reason_text are required" },
      { status: 400 }
    );
  }

  const db = createSupabaseAdminClient();
  if (!db) return NextResponse.json({ ok: false, error: "db_not_configured" }, { status: 503 });

  const { data: fine } = await db.from("fines").select("*").eq("id", fineId).single();
  if (!fine) return NextResponse.json({ ok: false, error: "fine not found" }, { status: 404 });
  if (fine.user_id !== me.id) {
    return NextResponse.json({ ok: false, error: "only the fined user can bid on this fine" }, { status: 403 });
  }
  if (fine.status !== "issued") {
    return NextResponse.json({ ok: false, error: `fine is already ${fine.status}, cannot bid` }, { status: 400 });
  }

  const { data: violation } = await db.from("violations").select("*").eq("id", fine.violation_id).single();
  if (!violation) return NextResponse.json({ ok: false, error: "violation not found" }, { status: 404 });

  await db.from("fines").update({ status: "bid_pending" }).eq("id", fineId);

  const result = await judgeFine(violation, fine, proposedAmount, reasonText, violation.streak_count_at_time);

  const bidStatus = result.verdict === "accept" ? "accepted" : result.verdict === "reject" ? "rejected" : "countered";

  const { data: bid } = await db
    .from("bids")
    .insert({
      fine_id: fineId,
      proposed_amount: proposedAmount,
      reason_text: reasonText,
      submitted_by: me.id,
      ai_evaluation: result.reasoning,
      status: bidStatus,
      counter_amount: result.counter_amount,
    })
    .select()
    .single();

  let finalAmount = fine.amount;
  let fineStatus: string = "issued";
  if (result.verdict === "accept") {
    finalAmount = proposedAmount;
    fineStatus = "accepted";
  } else if (result.verdict === "counter" && result.counter_amount) {
    finalAmount = result.counter_amount;
    fineStatus = "accepted";
  } else {
    finalAmount = fine.amount;
    fineStatus = "issued";
  }

  await db.from("fines").update({ amount: finalAmount, status: fineStatus }).eq("id", fineId);

  await notify({
    userId: me.id,
    type: "bid_judged",
    title:
      result.verdict === "accept"
        ? "Bid accepted"
        : result.verdict === "counter"
          ? "Bid countered"
          : "Bid rejected",
    body: `${result.reasoning} Fine now stands at ${formatNaira(finalAmount)}.`,
    relatedFineId: fineId,
  });

  return NextResponse.json({ ok: true, bid, verdict: result.verdict, final_amount: finalAmount });
}
