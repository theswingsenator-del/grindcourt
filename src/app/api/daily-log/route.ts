import { NextRequest, NextResponse } from "next/server";
import { getCurrentAppUser, createSupabaseAdminClient } from "@/lib/supabaseServer";

// Upserts today's daily_logs row for the current user — morning commit
// and/or night report. Called by the check-in page for both slots.
export async function POST(req: NextRequest) {
  const me = await getCurrentAppUser();
  if (!me) return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const slot = body?.slot;
  if (slot !== "morning" && slot !== "night") {
    return NextResponse.json({ ok: false, error: 'slot must be "morning" or "night"' }, { status: 400 });
  }
  const text = typeof body?.text === "string" ? body.text.trim() : "";

  const db = createSupabaseAdminClient();
  if (!db) return NextResponse.json({ ok: false, error: "db_not_configured" }, { status: 503 });

  const today = new Date().toISOString().slice(0, 10);
  const now = new Date().toISOString();

  const { data: existing } = await db
    .from("daily_logs")
    .select("*")
    .eq("owner_id", me.id)
    .eq("log_date", today)
    .maybeSingle();

  const patch =
    slot === "morning"
      ? { morning_commit_done: true, morning_commit_text: text || null, morning_commit_at: now }
      : { night_report_done: true, night_report_text: text || null, night_report_at: now };

  const { data: log, error } = existing
    ? await db.from("daily_logs").update(patch).eq("id", existing.id).select().single()
    : await db
        .from("daily_logs")
        .insert({ owner_id: me.id, log_date: today, ...patch })
        .select()
        .single();

  if (error || !log) {
    return NextResponse.json({ ok: false, error: error?.message ?? "failed to save log" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, log });
}
