import { NextRequest, NextResponse } from "next/server";
import { getCurrentAppUser, createSupabaseAdminClient } from "@/lib/supabaseServer";

// Self-resolve a personal stake — "mark paid" or "waive". Honor system: no
// partner approval, no AI Judge, since it's a private commitment device the
// owner set on themselves. Only the owner may resolve their own stake.
export async function POST(req: NextRequest) {
  const me = await getCurrentAppUser();
  if (!me) return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const id = typeof body?.id === "string" ? body.id : null;
  const status = body?.status === "paid" || body?.status === "waived" ? body.status : null;
  if (!id || !status) return NextResponse.json({ ok: false, error: "id and status ('paid'|'waived') are required" }, { status: 400 });

  const db = createSupabaseAdminClient();
  if (!db) return NextResponse.json({ ok: false, error: "db_not_configured" }, { status: 503 });

  const { data: stake } = await db.from("personal_stakes").select("*").eq("id", id).maybeSingle();
  if (!stake) return NextResponse.json({ ok: false, error: "stake not found" }, { status: 404 });
  if (stake.owner_id !== me.id) return NextResponse.json({ ok: false, error: "not your stake" }, { status: 403 });
  if (stake.status !== "active") return NextResponse.json({ ok: false, error: "already resolved" }, { status: 400 });

  const updates: Record<string, unknown> = { status };
  if (status === "paid") updates.paid_at = new Date().toISOString();

  const { data: updated, error } = await db.from("personal_stakes").update(updates).eq("id", id).select().single();
  if (error || !updated) {
    return NextResponse.json({ ok: false, error: error?.message ?? "failed to update stake" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, stake: updated });
}
