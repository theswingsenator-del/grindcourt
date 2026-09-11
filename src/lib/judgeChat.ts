// "Talk to the Judge" — a conversational task editor. Same Judge voice as
// lib/judge.ts, but here it can act: reassign/edit/create/hold a task
// through a strict JSON action protocol instead of just ruling on fines.
// Grounded in the user's actual current goals/tasks so it never invents a
// task_id — it can only act on tasks it was handed as context. Same
// retry-once-then-safe-fallback pattern as the rest of the Judge: a
// malformed response NEVER executes a guessed action.

import { SupabaseClient } from "@supabase/supabase-js";
import { askAI } from "./ai";
import { notify } from "./notify";
import { AppUser, JudgeChatAction, JudgeChatMessage } from "./types";

const SYSTEM_PROMPT = `You are the Judge inside GrindCourt, an accountability app between two business partners who fine each other real money for missed commitments. Here you are having a direct conversation with one partner, helping them manage their tasks by talking instead of tapping through the UI.

Rules you must follow exactly:
- Be direct and useful. No fluff, no over-explaining.
- You can take ONE action per message, or none at all if the message is just conversation/a question.
- You are given the user's real current goals and tasks as context (with real ids). You must NEVER invent a task_id, goal_id, or owner_id — only ever use ones given to you in the context below. If the user references a task that isn't in the context, say so and take no action.
- reassign_task is only valid to hand a task to the OTHER partner (their id is given in context) — never to the same owner it already has.
- Refuse hold_task or reassign_task on any task whose due_at has already passed — no one gets to dodge a fine that's already earned by moving or holding the task after the fact. If asked, explain that plainly in your reply and take no action.
- hold_task and reassign_task both change something the OTHER partner should know about — always mention in your reply that they'll be notified, and never treat either as quiet/private.
- You always return strict JSON only, matching exactly the schema given in the prompt. No markdown, no prose outside the JSON object.`;

function extractJSON(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced ? fenced[1] : trimmed;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("No JSON object found in AI response");
  return JSON.parse(raw.slice(start, end + 1));
}

export interface JudgeChatResult {
  reply: string;
  action: JudgeChatAction | null;
  actionSummary: string | null;
}

interface ContextTask {
  id: string;
  title: string;
  owner_id: string;
  status: string;
  approval_status: string;
  due_at: string | null;
  goal_id: string | null;
}

interface ContextGoal {
  id: string;
  title: string;
  owner_id: string;
}

// A task whose deadline already passed can't be held or reassigned away —
// that's exactly how someone would dodge a fine that's already earned by
// quietly moving the task after the fact. Only forward-looking changes are
// legitimate through this conversational path.
function isPastDue(task: ContextTask | undefined): boolean {
  return Boolean(task?.due_at && new Date(task.due_at).getTime() <= Date.now());
}

function isValidAction(
  value: unknown,
  validTaskIds: Set<string>,
  validGoalIds: Set<string>,
  meId: string,
  partnerId: string,
  tasksById: Map<string, ContextTask>
): value is JudgeChatAction {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Partial<JudgeChatAction>;
  if (v.type === "reassign_task") {
    if (typeof v.task_id !== "string" || !validTaskIds.has(v.task_id) || v.new_owner_id !== partnerId) return false;
    return !isPastDue(tasksById.get(v.task_id));
  }
  if (v.type === "edit_task") {
    if (typeof v.task_id !== "string" || !validTaskIds.has(v.task_id)) return false;
    if (v.title !== undefined && typeof v.title !== "string") return false;
    if (v.due_at !== undefined && v.due_at !== null && typeof v.due_at !== "string") return false;
    if (v.goal_id !== undefined && v.goal_id !== null && (typeof v.goal_id !== "string" || !validGoalIds.has(v.goal_id))) return false;
    return true;
  }
  if (v.type === "create_task") {
    if (typeof v.title !== "string" || !v.title.trim()) return false;
    if (v.owner_id !== meId && v.owner_id !== partnerId) return false;
    if (v.goal_id !== undefined && v.goal_id !== null && (typeof v.goal_id !== "string" || !validGoalIds.has(v.goal_id))) return false;
    if (v.blocked_by_task_id !== undefined && v.blocked_by_task_id !== null && (typeof v.blocked_by_task_id !== "string" || !validTaskIds.has(v.blocked_by_task_id))) return false;
    return true;
  }
  if (v.type === "hold_task") {
    if (typeof v.task_id !== "string" || !validTaskIds.has(v.task_id)) return false;
    if (v.approval_status !== "pending" && v.approval_status !== "approved") return false;
    if (v.approval_status === "pending" && isPastDue(tasksById.get(v.task_id))) return false;
    return true;
  }
  return false;
}

/**
 * Executes a validated action against the DB (service role) and returns a
 * short human-readable confirmation string, or null if execution failed.
 */
async function executeAction(
  db: SupabaseClient,
  action: JudgeChatAction,
  tasksById: Map<string, ContextTask>,
  meId: string,
  partnerId: string | undefined,
  partnerDisplayName: string,
  meDisplayName: string
): Promise<string | null> {
  if (action.type === "reassign_task") {
    const task = tasksById.get(action.task_id!);
    if (!task) return null;
    const { error } = await db.from("tasks").update({ owner_id: action.new_owner_id }).eq("id", action.task_id);
    if (error) return null;
    await notify({
      userId: action.new_owner_id!,
      type: "task_reassigned",
      title: "Task reassigned to you",
      body: `${meDisplayName} reassigned "${task.title}" to you via the Judge.`,
      relatedTaskId: action.task_id,
    });
    return `Reassigned "${task.title}" to ${partnerDisplayName}.`;
  }

  if (action.type === "edit_task") {
    const task = tasksById.get(action.task_id!);
    if (!task) return null;
    const updates: Record<string, unknown> = {};
    if (action.title) updates.title = action.title.trim();
    if (action.due_at !== undefined) updates.due_at = action.due_at;
    if (action.goal_id !== undefined) updates.goal_id = action.goal_id;
    const { error } = await db.from("tasks").update(updates).eq("id", action.task_id);
    if (error) return null;
    return `Updated "${action.title ?? task.title}".`;
  }

  if (action.type === "create_task") {
    const { error } = await db.from("tasks").insert({
      title: action.title!.trim(),
      due_at: action.due_at ?? null,
      goal_id: action.goal_id ?? null,
      owner_id: action.owner_id!,
      blocked_by_task_id: action.blocked_by_task_id ?? null,
      status: "pending",
      source: "manual",
      approval_status: "approved",
    });
    if (error) return null;
    if (action.owner_id !== meId) {
      await notify({
        userId: action.owner_id!,
        type: "task_created",
        title: "New task from the Judge",
        body: `${meDisplayName} added "${action.title}" to your docket via the Judge.`,
      });
    }
    return `Added "${action.title}" to the docket.`;
  }

  if (action.type === "hold_task") {
    const task = tasksById.get(action.task_id!);
    if (!task) return null;
    const { error } = await db.from("tasks").update({ approval_status: action.approval_status }).eq("id", action.task_id);
    if (error) return null;
    if (partnerId && task.owner_id === meId) {
      await notify({
        userId: partnerId,
        type: action.approval_status === "pending" ? "task_held" : "task_hold_released",
        title: action.approval_status === "pending" ? "Task put on hold" : "Task hold released",
        body: `${meDisplayName} ${action.approval_status === "pending" ? "put \"" + task.title + "\" on hold" : "released the hold on \"" + task.title + "\""} via the Judge.`,
        relatedTaskId: action.task_id,
      });
    }
    return action.approval_status === "pending"
      ? `Put "${task.title}" on hold.`
      : `Released the hold on "${task.title}".`;
  }

  return null;
}

/**
 * Runs one turn of "Talk to the Judge": fetches real goal/task context for
 * grounding, calls the AI, validates+executes any action, then persists
 * both the user's message and the assistant's reply to
 * judge_chat_messages. Never lets a malformed AI response execute an
 * action — falls back to action:null and a generic "didn't parse" reply.
 */
export async function runJudgeChat(
  db: SupabaseClient,
  me: AppUser,
  partner: AppUser | null,
  message: string,
  recentHistory: JudgeChatMessage[]
): Promise<JudgeChatResult> {
  const [{ data: myTasks }, { data: partnerTasks }, { data: goals }] = await Promise.all([
    db.from("tasks").select("id,title,owner_id,status,approval_status,due_at,goal_id").eq("owner_id", me.id),
    partner
      ? db.from("tasks").select("id,title,owner_id,status,approval_status,due_at,goal_id").eq("owner_id", partner.id)
      : Promise.resolve({ data: [] as ContextTask[] }),
    db.from("goals").select("id,title,owner_id"),
  ]);

  const allTasks: ContextTask[] = [...(myTasks ?? []), ...(partnerTasks ?? [])];
  const tasksById = new Map(allTasks.map((t) => [t.id, t]));
  const validTaskIds = new Set(allTasks.map((t) => t.id));
  const goalsList: ContextGoal[] = goals ?? [];
  const validGoalIds = new Set(goalsList.map((g) => g.id));

  const taskLines = allTasks
    .map(
      (t) =>
        `- id: ${t.id} | "${t.title}" | owner: ${t.owner_id === me.id ? me.display_name : partner?.display_name ?? "partner"} | status: ${t.status} | approval: ${t.approval_status}${t.due_at ? ` | due: ${t.due_at}` : ""}`
    )
    .join("\n");
  const goalLines = goalsList.map((g) => `- id: ${g.id} | "${g.title}"`).join("\n");
  const historyLines = recentHistory
    .slice(-10)
    .map((h) => `${h.role === "user" ? me.display_name : "Judge"}: ${h.content}`)
    .join("\n");

  const userPrompt = `You are talking with ${me.display_name}. Their partner is ${partner?.display_name ?? "not set up yet"} (id: ${partner?.id ?? "none"}).

Current tasks (both partners):
${taskLines || "(no tasks yet)"}

Current goals:
${goalLines || "(no goals yet)"}

${historyLines ? `Recent conversation:\n${historyLines}\n` : ""}
${me.display_name} just said: "${message}"

Return strict JSON only, matching exactly this schema:
{"reply": "your conversational reply", "action": null | {"type": "reassign_task", "task_id": "...", "new_owner_id": "..."} | {"type": "edit_task", "task_id": "...", "title": "...", "due_at": "...", "goal_id": "..."} | {"type": "create_task", "title": "...", "due_at": "...", "goal_id": "...", "owner_id": "...", "blocked_by_task_id": "..."} | {"type": "hold_task", "task_id": "...", "approval_status": "pending" | "approved"}}

- Only include an "action" if ${me.display_name} clearly asked for one of those four things to actually happen. Otherwise action must be null.
- Every task_id, goal_id, owner_id, new_owner_id you use MUST come exactly from the ids listed above — never invent one.
- edit_task/create_task fields you don't want to change should simply be omitted from the action object.`;

  let action: JudgeChatAction | null = null;
  let reply: string | null = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = await askAI(SYSTEM_PROMPT, userPrompt);
      const parsed = extractJSON(raw) as Partial<{ reply: unknown; action: unknown }>;
      if (typeof parsed.reply !== "string" || !parsed.reply.trim()) continue;
      if (parsed.action !== null && parsed.action !== undefined) {
        if (!isValidAction(parsed.action, validTaskIds, validGoalIds, me.id, partner?.id ?? "", tasksById)) continue;
        action = parsed.action;
      }
      reply = parsed.reply;
      break;
    } catch {
      // fall through to retry
    }
  }

  let actionSummary: string | null = null;
  if (reply === null) {
    reply = "Something didn't parse right, try rephrasing.";
    action = null;
  } else if (action) {
    actionSummary = await executeAction(db, action, tasksById, me.id, partner?.id, partner?.display_name ?? "your partner", me.display_name);
    if (!actionSummary) action = null; // execution failed — don't claim it happened
  }

  await db.from("judge_chat_messages").insert([
    { user_id: me.id, role: "user", content: message, action_json: null },
    { user_id: me.id, role: "assistant", content: reply, action_json: action },
  ]);

  return { reply, action, actionSummary };
}
