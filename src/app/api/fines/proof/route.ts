import { NextRequest, NextResponse } from "next/server";
import { getCurrentAppUser, createSupabaseAdminClient } from "@/lib/supabaseServer";
import { notify } from "@/lib/notify";

// Accepts a multipart/form-data upload: fields `fine_id` and `file`.
// Uploads to the private `payment-proofs` Storage bucket (writes always go
// through the service-role key — the bucket has no public insert policy)
// and creates the payment_proofs row. Sets fine.status = paid_pending_proof.
export async function POST(req: NextRequest) {
  const me = await getCurrentAppUser();
  if (!me) return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });

  const form = await req.formData().catch(() => null);
  const fineId = form?.get("fine_id");
  const file = form?.get("file");

  if (typeof fineId !== "string" || !fineId || !(file instanceof File)) {
    return NextResponse.json({ ok: false, error: "fine_id and file are required" }, { status: 400 });
  }
  if (!file.type.startsWith("image/")) {
    return NextResponse.json({ ok: false, error: "file must be an image" }, { status: 400 });
  }

  const db = createSupabaseAdminClient();
  if (!db) return NextResponse.json({ ok: false, error: "db_not_configured" }, { status: 503 });

  const { data: fine } = await db.from("fines").select("*").eq("id", fineId).single();
  if (!fine) return NextResponse.json({ ok: false, error: "fine not found" }, { status: 404 });
  if (fine.user_id !== me.id) {
    return NextResponse.json({ ok: false, error: "only the fined user can submit proof" }, { status: 403 });
  }

  const ext = file.name.split(".").pop() || "jpg";
  const path = `${fine.id}/${Date.now()}.${ext}`;
  const bytes = new Uint8Array(await file.arrayBuffer());

  const { error: uploadErr } = await db.storage
    .from("payment-proofs")
    .upload(path, bytes, { contentType: file.type, upsert: false });
  if (uploadErr) {
    return NextResponse.json({ ok: false, error: `upload failed: ${uploadErr.message}` }, { status: 500 });
  }

  const { data: proof, error: proofErr } = await db
    .from("payment_proofs")
    .insert({ fine_id: fineId, uploaded_by: me.id, image_url: path })
    .select()
    .single();
  if (proofErr || !proof) {
    return NextResponse.json({ ok: false, error: proofErr?.message ?? "failed to save proof" }, { status: 500 });
  }

  await db.from("fines").update({ status: "paid_pending_proof" }).eq("id", fineId);

  const { data: partner } = await db.from("app_users").select("*").neq("id", me.id).maybeSingle();
  if (partner) {
    await notify({
      userId: partner.id,
      type: "proof_submitted",
      title: "Payment proof submitted",
      body: `${me.display_name} uploaded proof for a fine — review and approve it to stop the nags.`,
      relatedFineId: fineId,
    });
  }

  return NextResponse.json({ ok: true, proof });
}
