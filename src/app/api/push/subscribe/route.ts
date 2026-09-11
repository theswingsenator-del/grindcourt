import { NextRequest, NextResponse } from "next/server";
import { getCurrentAppUser, createSupabaseAdminClient } from "@/lib/supabaseServer";

export async function POST(req: NextRequest) {
  const me = await getCurrentAppUser();
  if (!me) return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });

  const db = createSupabaseAdminClient();
  if (!db) return NextResponse.json({ ok: false, error: "db_not_configured" }, { status: 503 });

  const sub = await req.json();
  if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
    return NextResponse.json({ ok: false, error: "bad_subscription" }, { status: 400 });
  }

  const { error } = await db.from("push_subscriptions").upsert(
    {
      endpoint: sub.endpoint,
      user_id: me.id,
      p256dh: sub.keys.p256dh,
      auth: sub.keys.auth,
      user_agent: req.headers.get("user-agent") ?? null,
    },
    { onConflict: "endpoint" }
  );

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const me = await getCurrentAppUser();
  if (!me) return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });

  const db = createSupabaseAdminClient();
  if (!db) return NextResponse.json({ ok: false }, { status: 503 });

  const { endpoint } = await req.json();
  await db.from("push_subscriptions").delete().eq("endpoint", endpoint).eq("user_id", me.id);
  return NextResponse.json({ ok: true });
}
