import { NextRequest, NextResponse } from "next/server";
import { getCurrentAppUser, createSupabaseAdminClient } from "@/lib/supabaseServer";
import { notify } from "@/lib/notify";

// Partner approves the uploaded payment proof. This is the ONLY thing that
// stops the Police from nagging on a fine — the cron scan's nag query
// excludes fines with status paid_approved (see src/app/api/cron/scan/route.ts).
export async function POST(req: NextRequest) {
  const me = await getCurrentAppUser();
  if (!me) return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const proofId = typeof body?.proof_id === "string" ? body.proof_id : null;
  if (!proofId) return NextResponse.json({ ok: false, error: "proof_id is required" }, { status: 400 });

  const db = createSupabaseAdminClient();
  if (!db) return NextResponse.json({ ok: false, error: "db_not_configured" }, { status: 503 });

  const { data: proof } = await db.from("payment_proofs").select("*").eq("id", proofId).single();
  if (!proof) return NextResponse.json({ ok: false, error: "proof not found" }, { status: 404 });
  if (proof.uploaded_by === me.id) {
    return NextResponse.json({ ok: false, error: "you cannot approve your own proof" }, { status: 403 });
  }

  const now = new Date().toISOString();
  await db.from("payment_proofs").update({ approved_by_partner: true, approved_at: now }).eq("id", proofId);
  await db.from("fines").update({ status: "paid_approved" }).eq("id", proof.fine_id);
  await db.from("notifications").delete().eq("type", "police_nag").eq("related_fine_id", proof.fine_id);

  await notify({
    userId: proof.uploaded_by,
    type: "proof_approved",
    title: "Payment approved",
    body: "Your partner approved your payment proof. The nagging stops now.",
    relatedFineId: proof.fine_id,
  });

  return NextResponse.json({ ok: true });
}
