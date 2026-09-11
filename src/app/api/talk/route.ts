import { NextRequest, NextResponse } from "next/server";
import { getCurrentAppUser, createSupabaseAdminClient } from "@/lib/supabaseServer";
import { runJudgeChat } from "@/lib/judgeChat";
import { JudgeChatMessage } from "@/lib/types";

// POST /api/talk — one turn of "Talk to the Judge". Body: {message}.
export async function POST(req: NextRequest) {
  const me = await getCurrentAppUser();
  if (!me) return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  if (!message) return NextResponse.json({ ok: false, error: "message is required" }, { status: 400 });

  const db = createSupabaseAdminClient();
  if (!db) return NextResponse.json({ ok: false, error: "db_not_configured" }, { status: 503 });

  const { data: partner } = await db.from("app_users").select("*").neq("id", me.id).maybeSingle();

  const { data: recentHistory } = await db
    .from("judge_chat_messages")
    .select("*")
    .eq("user_id", me.id)
    .order("created_at", { ascending: false })
    .limit(10);

  const result = await runJudgeChat(
    db,
    me,
    partner ?? null,
    message,
    ((recentHistory ?? []) as JudgeChatMessage[]).reverse()
  );

  return NextResponse.json({ ok: true, reply: result.reply, action_taken: result.actionSummary });
}
