import { NextRequest, NextResponse } from "next/server";
import { getCurrentAppUser, createSupabaseAdminClient } from "@/lib/supabaseServer";

// Plain goal creation — no AI, no auto-generated tasks. Sits alongside
// /api/goals/breakdown (AI decomposition into a full task plan) the same
// way /api/tasks (manual) sits alongside the Assistant's AI capture: a
// goal shouldn't require going through a full AI breakdown just to exist
// as a container other tasks can be linked to.
export async function POST(req: NextRequest) {
  const me = await getCurrentAppUser();
  if (!me) return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  const description = typeof body?.description === "string" ? body.description.trim() || null : null;
  const targetDate = typeof body?.target_date === "string" && body.target_date ? body.target_date : null;
  const visibility = body?.visibility === "personal" ? "personal" : "partner";

  if (!title) return NextResponse.json({ ok: false, error: "title is required" }, { status: 400 });

  const db = createSupabaseAdminClient();
  if (!db) return NextResponse.json({ ok: false, error: "db_not_configured" }, { status: 503 });

  const { data: goal, error } = await db
    .from("goals")
    .insert({ owner_id: me.id, title, description, target_date: targetDate, visibility })
    .select()
    .single();

  if (error || !goal) {
    return NextResponse.json({ ok: false, error: error?.message ?? "failed to create goal" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, goal });
}
