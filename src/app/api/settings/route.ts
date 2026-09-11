import { NextRequest, NextResponse } from "next/server";
import { getCurrentAppUser, createSupabaseAdminClient } from "@/lib/supabaseServer";

// GET — the caller's Board Conduct settings (creates a default row on read
// if none exists yet, so the UI always has something to render).
export async function GET() {
  const me = await getCurrentAppUser();
  if (!me) return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });

  const db = createSupabaseAdminClient();
  if (!db) return NextResponse.json({ ok: false, error: "db_not_configured" }, { status: 503 });

  let { data: settings } = await db.from("conduct_settings").select("*").eq("user_id", me.id).maybeSingle();
  if (!settings) {
    const { data: created } = await db
      .from("conduct_settings")
      .insert({ user_id: me.id })
      .select()
      .single();
    settings = created;
  }

  const { data: baseline } = await db.from("auditor_baseline").select("*").eq("user_id", me.id).maybeSingle();

  // Push delivery verification (feature 6) — push_subscriptions has no
  // client-readable RLS policy (unlike the rest of the schema), so this
  // has to be surfaced through an authenticated route rather than a direct
  // client query.
  const { count: pushSubCount } = await db
    .from("push_subscriptions")
    .select("endpoint", { count: "exact", head: true })
    .eq("user_id", me.id);

  const { data: lastNotification } = await db
    .from("notifications")
    .select("push_sent_count, push_pruned_count")
    .eq("user_id", me.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return NextResponse.json({
    ok: true,
    settings,
    auditor_sample_size: baseline?.sample_size ?? 0,
    push_subscription_count: pushSubCount ?? 0,
    last_notification_push_sent_count: lastNotification?.push_sent_count ?? null,
  });
}

// POST — upserts the caller's Board Conduct settings.
export async function POST(req: NextRequest) {
  const me = await getCurrentAppUser();
  if (!me) return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const updates: Record<string, unknown> = { user_id: me.id, updated_at: new Date().toISOString() };
  if (body?.nag_tone === "blunt" || body?.nag_tone === "roast" || body?.nag_tone === "formal") {
    updates.nag_tone = body.nag_tone;
  }
  if (typeof body?.predictor_enabled === "boolean") {
    updates.predictor_enabled = body.predictor_enabled;
  }

  const db = createSupabaseAdminClient();
  if (!db) return NextResponse.json({ ok: false, error: "db_not_configured" }, { status: 503 });

  const { data: settings, error } = await db
    .from("conduct_settings")
    .upsert(updates, { onConflict: "user_id" })
    .select()
    .single();

  if (error || !settings) {
    return NextResponse.json({ ok: false, error: error?.message ?? "failed to update settings" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, settings });
}
