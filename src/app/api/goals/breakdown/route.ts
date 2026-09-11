import { NextRequest, NextResponse } from "next/server";
import { getCurrentAppUser, createSupabaseAdminClient } from "@/lib/supabaseServer";
import { breakdownGoal, GoalBreakdownError } from "@/lib/goalBreakdown";

// Creates the goal row, calls the AI to decompose it into
// milestones -> weeks -> daily tasks, then writes real task rows with
// computed due dates spread across the plan.
export async function POST(req: NextRequest) {
  const me = await getCurrentAppUser();
  if (!me) return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  const description = typeof body?.description === "string" ? body.description.trim() : "";
  const targetDate = typeof body?.target_date === "string" && body.target_date ? body.target_date : null;

  if (!title) {
    return NextResponse.json({ ok: false, error: "title is required" }, { status: 400 });
  }

  const db = createSupabaseAdminClient();
  if (!db) return NextResponse.json({ ok: false, error: "db_not_configured" }, { status: 503 });

  let breakdown;
  try {
    breakdown = await breakdownGoal(title, description || null, targetDate);
  } catch (err) {
    const message = err instanceof GoalBreakdownError ? err.message : "AI breakdown failed";
    return NextResponse.json({ ok: false, error: message, retryable: true }, { status: 502 });
  }

  const { data: goal, error: goalErr } = await db
    .from("goals")
    .insert({ owner_id: me.id, title, description: description || null, target_date: targetDate })
    .select()
    .single();
  if (goalErr || !goal) {
    return NextResponse.json({ ok: false, error: goalErr?.message ?? "failed to create goal" }, { status: 500 });
  }

  // Spread daily tasks across real calendar dates: week 0 starts tomorrow,
  // each subsequent week starts 7 days later; tasks within a week land on
  // consecutive days, clamped to the 7-day window.
  const startDate = new Date();
  startDate.setDate(startDate.getDate() + 1);
  startDate.setHours(9, 0, 0, 0);

  const taskRows: Array<{
    goal_id: string;
    owner_id: string;
    title: string;
    description: string;
    due_at: string;
    status: "pending";
  }> = [];

  let weekIndex = 0;
  for (const milestone of breakdown.milestones) {
    for (const week of milestone.weeks) {
      const weekStart = new Date(startDate);
      weekStart.setDate(weekStart.getDate() + weekIndex * 7);
      week.daily_tasks.forEach((task, dayIndex) => {
        const dueAt = new Date(weekStart);
        dueAt.setDate(dueAt.getDate() + Math.min(dayIndex, 6));
        taskRows.push({
          goal_id: goal.id,
          owner_id: me.id,
          title: `[${milestone.title}] ${task.title}`,
          description: task.description,
          due_at: dueAt.toISOString(),
          status: "pending",
        });
      });
      weekIndex += 1;
    }
  }

  const { data: tasks, error: tasksErr } = await db.from("tasks").insert(taskRows).select();
  if (tasksErr) {
    return NextResponse.json(
      { ok: false, error: `goal created but tasks failed: ${tasksErr.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, goal, tasks, breakdown });
}
