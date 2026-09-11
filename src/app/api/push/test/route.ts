import { NextResponse } from "next/server";
import { getCurrentAppUser } from "@/lib/supabaseServer";
import { sendPushToUser } from "@/lib/push";

export async function POST() {
  const me = await getCurrentAppUser();
  if (!me) return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });

  const result = await sendPushToUser(me.id, {
    title: "GrindCourt",
    body: "Test notification — if you see this, push is wired up.",
  });
  return NextResponse.json(result);
}
