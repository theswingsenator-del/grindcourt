import { NextRequest, NextResponse } from "next/server";
import { getCurrentAppUser, createSupabaseAdminClient } from "@/lib/supabaseServer";
import { restDaysEarnedFromCompletedCount, TASKS_PER_REST_DAY } from "@/lib/restDays";
import { notify } from "@/lib/notify";
import { updateBaseline, checkForPadding } from "@/lib/auditor";
import { looksOutcomeSensitive, promptCheckin } from "@/lib/checkin";
import { issueFine } from "@/lib/issueFine";
import { localDateString } from "@/lib/timezone";
import { isEnforcementLive } from "@/lib/violations";
import { AppUser } from "@/lib/types";

// Creates a standalone task (goal_id is optional/nullable — free-floating
// tasks are allowed per spec).
export async function POST(req: NextRequest) {
  const me = await getCurrentAppUser();
  if (!me) return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  if (!title) return NextResponse.json({ ok: false, error: "title is required" }, { status: 400 });

  const description = typeof body?.description === "string" ? body.description.trim() || null : null;
  const dueAt = typeof body?.due_at === "string" && body.due_at ? body.due_at : null;
  const goalId = typeof body?.goal_id === "string" && body.goal_id ? body.goal_id : null;
  const blockedByTaskId = typeof body?.blocked_by_task_id === "string" && body.blocked_by_task_id ? body.blocked_by_task_id : null;
  const visibility = body?.visibility === "personal" ? "personal" : "partner";

  const db = createSupabaseAdminClient();
  if (!db) return NextResponse.json({ ok: false, error: "db_not_configured" }, { status: 503 });

  const { data: task, error } = await db
    .from("tasks")
    .insert({ owner_id: me.id, title, description, due_at: dueAt, goal_id: goalId, blocked_by_task_id: blockedByTaskId, status: "pending", visibility })
    .select()
    .single();

  if (error || !task) {
    return NextResponse.json({ ok: false, error: error?.message ?? "failed to create task" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, task });
}

// PATCH — marks a task done (or edits it). Completing a task:
//   1. sets status/completed_at
//   2. re-derives rest-day earn from the owner's total completed count
//      (writes a new `earned` rest_days row only for the newly-crossed
//      TASKS_PER_REST_DAY threshold, so it's idempotent-safe on retries)
//   3. notifies the partner
export async function PATCH(req: NextRequest) {
  const me = await getCurrentAppUser();
  if (!me) return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const id = typeof body?.id === "string" ? body.id : null;
  if (!id) return NextResponse.json({ ok: false, error: "id is required" }, { status: 400 });

  const db = createSupabaseAdminClient();
  if (!db) return NextResponse.json({ ok: false, error: "db_not_configured" }, { status: 503 });

  const { data: existing } = await db.from("tasks").select("*").eq("id", id).single();
  if (!existing) return NextResponse.json({ ok: false, error: "task not found" }, { status: 404 });

  const updates: Record<string, unknown> = {};
  if (typeof body.title === "string") updates.title = body.title.trim();
  if (typeof body.description === "string") updates.description = body.description.trim() || null;
  if (typeof body.due_at === "string") updates.due_at = body.due_at || null;

  const markingDone = body.status === "done" && existing.status !== "done";
  if (markingDone) {
    updates.status = "done";
    updates.completed_at = new Date().toISOString();
  } else if (body.status === "pending") {
    updates.status = "pending";
    updates.completed_at = null;
  }

  const { data: task, error } = await db.from("tasks").update(updates).eq("id", id).select().single();
  if (error || !task) {
    return NextResponse.json({ ok: false, error: error?.message ?? "failed to update task" }, { status: 500 });
  }

  if (markingDone) {
    const { count: completedCount } = await db
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("owner_id", task.owner_id)
      .eq("status", "done");

    const totalDone = completedCount ?? 0;
    const alreadyEarned = restDaysEarnedFromCompletedCount(totalDone - 1);
    const nowEarned = restDaysEarnedFromCompletedCount(totalDone);
    if (nowEarned > alreadyEarned) {
      await db.from("rest_days").insert({
        owner_id: task.owner_id,
        kind: "earned",
        delta: nowEarned - alreadyEarned,
        reason: `${TASKS_PER_REST_DAY} tasks completed`,
        related_task_id: task.id,
      });
    }

    // A personal stake is a self-motivation device tied to finishing the
    // task — once the task is done, the stake has served its purpose and
    // should never sit around as a fine. Auto-waive any still-active stake.
    if (task.visibility === "personal") {
      await db
        .from("personal_stakes")
        .update({ status: "waived" })
        .eq("task_id", task.id)
        .eq("status", "active");
    }

    // Personal tasks are invisible to the partner by design — never notify
    // them about completion, title, or anything else on a personal task.
    if (task.visibility !== "personal") {
      const { data: partner } = await db.from("app_users").select("*").neq("id", task.owner_id).maybeSingle();
      if (partner) {
        await notify({
          userId: partner.id,
          type: "task_completed",
          title: "Task completed",
          body: `${me.display_name} finished "${task.title}".`,
          relatedTaskId: task.id,
        });
      }
    }

    // Auditor: soft-launch, log-only anti-gaming check — never blocks the
    // completion and never surfaces a visible accusation.
    await checkForPadding(db, task.owner_id, task.id, task.title);
    await updateBaseline(db, task.owner_id);

    // Outcome Check-ins: some tasks carry an implicit real-world target
    // (revenue, a specific measurable result) beyond just checking the box.
    // Prompt a quick honest follow-up only when the task (or its parent
    // goal) looks tied to a real outcome — most tasks never trigger this.
    let goalTitle: string | null = null;
    if (task.goal_id) {
      const { data: goal } = await db.from("goals").select("title").eq("id", task.goal_id).maybeSingle();
      goalTitle = goal?.title ?? null;
    }
    if (looksOutcomeSensitive(task.title, goalTitle)) {
      await promptCheckin(db, task.id, task.owner_id);
    }

    // Tiered lateness: finished late but on the SAME local calendar day as
    // the deadline gets a small, separate late_completion fine right now —
    // NOT the big task_overdue ladder, which only fires via cron once the
    // day due_at fell on has fully closed with the task still pending (see
    // lib/violations.ts detectOverdueTasks).
    if (task.due_at && task.completed_at && task.visibility !== "personal") {
      const { data: owner } = await db.from("app_users").select("*").eq("id", task.owner_id).maybeSingle();
      if (owner && isEnforcementLive(owner as AppUser, new Date())) {
        const completedAt = new Date(task.completed_at);
        const dueAt = new Date(task.due_at);
        const isLate = completedAt.getTime() > dueAt.getTime();
        const sameLocalDay = localDateString(completedAt, owner.timezone) === localDateString(dueAt, owner.timezone);
        if (isLate && sameLocalDay) {
          await issueFine(
            task.owner_id,
            "late_completion",
            task.id,
            `Task "${task.title}" was due ${task.due_at} and completed late the same day, at ${task.completed_at}.`
          );
        }
      }
    }
  }

  return NextResponse.json({ ok: true, task });
}
