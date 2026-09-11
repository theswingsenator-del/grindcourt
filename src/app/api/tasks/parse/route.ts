import { NextRequest, NextResponse } from "next/server";
import { getCurrentAppUser, createSupabaseAdminClient } from "@/lib/supabaseServer";
import { parseNaturalLanguageTask, ParseRateLimitError } from "@/lib/planner";

// Parses a loose sentence into a structured task draft. Does NOT create
// the task — the caller shows the draft for review/edit, then POSTs the
// confirmed version to /api/tasks like any manual task.
export async function POST(req: NextRequest) {
  const me = await getCurrentAppUser();
  if (!me) return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text) return NextResponse.json({ ok: false, error: "text is required" }, { status: 400 });

  const db = createSupabaseAdminClient();
  if (!db) return NextResponse.json({ ok: false, error: "db_not_configured" }, { status: 503 });

  try {
    const draft = await parseNaturalLanguageTask(db, me.id, text);
    if (!draft) return NextResponse.json({ ok: false, error: "Could not parse that into a task. Try rephrasing." }, { status: 422 });
    return NextResponse.json({ ok: true, draft });
  } catch (err) {
    if (err instanceof ParseRateLimitError) {
      return NextResponse.json(
        { ok: false, error: "The AI hit its daily limit — nothing to do with your input. Add it manually below.", rateLimited: true },
        { status: 503 }
      );
    }
    throw err;
  }
}
