import { NextRequest, NextResponse } from "next/server";
import { getCurrentAppUser, createSupabaseAdminClient } from "@/lib/supabaseServer";
import { assessCheckinResponse } from "@/lib/checkin";

// Answers an Outcome Check-in prompt. Only the person the prompt was
// addressed to can answer it.
export async function POST(req: NextRequest) {
  const me = await getCurrentAppUser();
  if (!me) return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const checkinId = typeof body?.checkin_id === "string" ? body.checkin_id : null;
  const responseText = typeof body?.response_text === "string" ? body.response_text.trim() : "";
  const dismiss = body?.dismiss === true;
  if (!checkinId || !responseText) {
    return NextResponse.json({ ok: false, error: "checkin_id and response_text are required" }, { status: 400 });
  }

  const db = createSupabaseAdminClient();
  if (!db) return NextResponse.json({ ok: false, error: "db_not_configured" }, { status: 503 });

  const { data: checkin } = await db.from("task_checkins").select("*").eq("id", checkinId).single();
  if (!checkin) return NextResponse.json({ ok: false, error: "checkin not found" }, { status: 404 });
  if (checkin.user_id !== me.id) {
    return NextResponse.json({ ok: false, error: "only the person this check-in was addressed to can answer it" }, { status: 403 });
  }
  if (checkin.response_text) {
    return NextResponse.json({ ok: false, error: "this check-in has already been answered" }, { status: 400 });
  }

  // Dismiss = no answer worth logging, skip the AI assessment and follow-up
  // generation entirely — just close the prompt out so it stops sitting in
  // the Inbox forever.
  if (dismiss) {
    await db
      .from("task_checkins")
      .update({ response_text: responseText, responded_at: new Date().toISOString(), ai_assessment: "unclear", follow_up_created: false })
      .eq("id", checkinId);
    return NextResponse.json({ ok: true, assessment: "unclear", follow_ups_created: 0 });
  }

  const { data: task } = await db.from("tasks").select("*").eq("id", checkin.task_id).single();
  if (!task) return NextResponse.json({ ok: false, error: "task not found" }, { status: 404 });

  const result = await assessCheckinResponse(db, checkin, task, responseText);

  return NextResponse.json({
    ok: true,
    assessment: result.assessment,
    reasoning: result.reasoning,
    follow_ups_created: result.assessment === "short" ? result.follow_up_tasks.length : 0,
  });
}
