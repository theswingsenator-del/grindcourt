import { NextRequest, NextResponse } from "next/server";
import { getCurrentAppUser, createSupabaseAdminClient } from "@/lib/supabaseServer";
import { evaluatePlea } from "@/lib/treasury";
import { notify } from "@/lib/notify";

// POST — a partner pleads for a different priority than the Board's
// current active proposal. The Board evaluates it immediately.
export async function POST(req: NextRequest) {
  const me = await getCurrentAppUser();
  if (!me) return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const reasonText = typeof body?.reason_text === "string" ? body.reason_text.trim() : "";
  if (!reasonText) {
    return NextResponse.json({ ok: false, error: "reason_text is required" }, { status: 400 });
  }

  const db = createSupabaseAdminClient();
  if (!db) return NextResponse.json({ ok: false, error: "db_not_configured" }, { status: 503 });

  const { data: proposal } = await db.from("war_chest_proposals").select("*").eq("status", "active").maybeSingle();
  if (!proposal) {
    return NextResponse.json({ ok: false, error: "no active proposal to plead against right now" }, { status: 400 });
  }

  const result = await evaluatePlea(db, proposal, reasonText);

  const { data: plea } = await db
    .from("war_chest_pleas")
    .insert({
      proposal_id: proposal.id,
      submitted_by: me.id,
      reason_text: reasonText,
      ai_response: result.ai_response,
    })
    .select()
    .single();

  const { data: partner } = await db.from("app_users").select("*").neq("id", me.id).maybeSingle();
  if (partner) {
    await notify({
      userId: partner.id,
      type: "treasury_plea_filed",
      title: "Plea filed with the Board",
      body: `${me.display_name} pled for a different priority. ${result.ai_response}`,
    });
  }

  return NextResponse.json({ ok: true, plea, switched: result.switched, ai_response: result.ai_response });
}
