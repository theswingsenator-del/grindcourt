"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "@/lib/useSession";
import { useRealtimeQuery } from "@/lib/useRealtimeTable";
import { supabase } from "@/lib/supabase";
import { Task, TaskCollaborator, TaskNote, AppUser, TaskExtensionRequest } from "@/lib/types";
import BottomNav from "@/components/BottomNav";

interface TaskDetailData {
  task: Task | null;
  collaborators: TaskCollaborator[];
  notes: TaskNote[];
  users: AppUser[];
  extensionRequests: TaskExtensionRequest[];
  blockingTask: Task | null;
}

async function fetchTaskDetail(taskId: string | undefined): Promise<TaskDetailData> {
  if (!taskId) return { task: null, collaborators: [], notes: [], users: [], extensionRequests: [], blockingTask: null };
  const [{ data: task }, { data: collaborators }, { data: notes }, { data: users }, { data: extensionRequests }] =
    await Promise.all([
      supabase.from("tasks").select("*").eq("id", taskId).maybeSingle(),
      supabase.from("task_collaborators").select("*").eq("task_id", taskId),
      supabase.from("task_notes").select("*").eq("task_id", taskId).order("created_at", { ascending: true }),
      supabase.from("app_users").select("*"),
      supabase
        .from("task_extension_requests")
        .select("*")
        .eq("task_id", taskId)
        .order("created_at", { ascending: false }),
    ]);
  let blockingTask: Task | null = null;
  if (task?.blocked_by_task_id) {
    const { data: blocker } = await supabase.from("tasks").select("*").eq("id", task.blocked_by_task_id).maybeSingle();
    blockingTask = blocker ?? null;
  }
  return {
    task: task ?? null,
    collaborators: collaborators ?? [],
    notes: notes ?? [],
    users: users ?? [],
    extensionRequests: extensionRequests ?? [],
    blockingTask,
  };
}

function initials(name: string): string {
  return name
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function TaskDetailPage() {
  const params = useParams();
  const taskId = typeof params?.id === "string" ? params.id : Array.isArray(params?.id) ? params.id[0] : undefined;
  const router = useRouter();
  const { appUser } = useSession();
  const { data, reload } = useRealtimeQuery(
    ["tasks", "task_collaborators", "task_notes", "task_extension_requests"],
    () => fetchTaskDetail(taskId),
    [taskId]
  );

  const [noteText, setNoteText] = useState("");
  const [posting, setPosting] = useState(false);
  const [joining, setJoining] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [completing, setCompleting] = useState(false);

  const [showExtend, setShowExtend] = useState(false);
  const [extendReason, setExtendReason] = useState("");
  const [extendDueAt, setExtendDueAt] = useState("");
  const [extending, setExtending] = useState(false);

  const userById = useMemo(() => {
    const map = new Map<string, AppUser>();
    for (const u of data?.users ?? []) map.set(u.id, u);
    return map;
  }, [data]);

  if (!data || !data.task || !appUser) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4">
        <div className="w-9 h-9 rounded-full border-2 border-ink-faint/25 border-t-ink animate-spin" />
      </div>
    );
  }

  const { task, collaborators, notes, extensionRequests, blockingTask } = data;
  const latestExtension = extensionRequests[0];
  const owner = userById.get(task.owner_id);
  const isOwner = task.owner_id === appUser.id;
  const approvedCollabs = collaborators.filter((c) => c.status === "approved");
  const pendingRequests = collaborators.filter((c) => c.status === "requested");
  const myCollab = collaborators.find((c) => c.user_id === appUser.id);
  const isApprovedCollaborator = myCollab?.status === "approved";
  const canPostNote = isOwner || isApprovedCollaborator;
  const isBlocked = Boolean(blockingTask && blockingTask.status !== "done");
  const canMarkDone = (isOwner || isApprovedCollaborator) && task.status !== "done" && !isBlocked;

  async function submitNote() {
    if (!noteText.trim() || !taskId) return;
    setPosting(true);
    await fetch("/api/tasks/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task_id: taskId, body: noteText.trim() }),
    });
    setPosting(false);
    setNoteText("");
    reload();
  }

  async function requestJoin() {
    if (!taskId) return;
    setJoining(true);
    await fetch("/api/tasks/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task_id: taskId }),
    });
    setJoining(false);
    reload();
  }

  async function respondJoin(collaboratorUserId: string, approve: boolean) {
    if (!taskId) return;
    await fetch("/api/tasks/join/respond", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task_id: taskId, collaborator_user_id: collaboratorUserId, approve }),
    });
    reload();
  }

  async function toggleNeedsHelp() {
    if (!taskId) return;
    setToggling(true);
    await fetch("/api/tasks/need-help", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task_id: taskId, needs_help: !task.needs_help }),
    });
    setToggling(false);
    reload();
  }

  async function markDone() {
    if (!taskId) return;
    setCompleting(true);
    await fetch("/api/tasks", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: taskId, status: "done" }),
    });
    setCompleting(false);
    reload();
  }

  async function submitExtend() {
    if (!taskId || !extendReason.trim() || !extendDueAt) return;
    setExtending(true);
    await fetch("/api/tasks/extend", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        task_id: taskId,
        reason_text: extendReason.trim(),
        requested_due_at: new Date(extendDueAt).toISOString(),
      }),
    });
    setExtending(false);
    setShowExtend(false);
    setExtendReason("");
    setExtendDueAt("");
    reload();
  }

  return (
    <div className="flex-1 flex flex-col">
      <div className="flex-1 flex flex-col px-5 pt-[calc(1.4rem+env(safe-area-inset-top))] pb-28 gap-5 max-w-md w-full mx-auto">
        <header className="rise rise-1">
          <button onClick={() => router.back()} className="label mb-2">&larr; Back</button>
          <h1 className="display text-2xl font-bold leading-snug">{task.title}</h1>
          <div className="flex items-center gap-2 mt-2">
            <div className="avatar">{owner ? initials(owner.display_name) : "?"}</div>
            <p className="text-[12px] text-ink-dim">{owner?.display_name ?? "Unknown"}&apos;s work order</p>
          </div>
          {approvedCollabs.length > 0 && (
            <div className="flex items-center gap-1.5 mt-2">
              {approvedCollabs.map((c) => {
                const u = userById.get(c.user_id);
                return (
                  <div key={c.id} className="avatar" title={u?.display_name}>
                    {u ? initials(u.display_name) : "?"}
                  </div>
                );
              })}
              <span className="label">shared credit</span>
            </div>
          )}
          {task.needs_help && (
            <p className="text-[11px] mt-2 text-red font-bold uppercase tracking-wide">Flagged — needs help</p>
          )}
        </header>

        {task.description && (
          <section className="rise rise-2 panel rounded-xl px-4 py-3">
            <p className="text-[12.5px] text-ink-dim leading-snug">{task.description}</p>
          </section>
        )}

        {isBlocked && blockingTask && (
          <section className="rise rise-2 panel-strong rounded-xl px-4 py-3">
            <p className="text-[11px] font-bold text-amber uppercase tracking-wide mb-1">Blocked</p>
            <p className="text-[12.5px] text-ink leading-snug">
              Blocked by:{" "}
              <Link href={`/task/${blockingTask.id}`} className="font-semibold underline">
                {blockingTask.title}
              </Link>
            </p>
            <p className="text-[11.5px] text-ink-dim mt-1">Can&apos;t mark done until that task is done first.</p>
          </section>
        )}

        <section className="rise rise-2 flex gap-2">
          {task.status !== "done" && !isOwner && !myCollab && (
            <button
              onClick={requestJoin}
              disabled={joining}
              className="btn-ghost flex-1 rounded-xl py-3 text-sm font-bold disabled:opacity-50 active:scale-[0.98] transition-transform"
            >
              {joining ? "Requesting..." : "Request to join"}
            </button>
          )}
          {isOwner && (
            <button
              onClick={toggleNeedsHelp}
              disabled={toggling}
              className={`flex-1 rounded-xl py-3 text-sm font-bold disabled:opacity-50 active:scale-[0.98] transition-transform ${
                task.needs_help ? "btn-danger" : "btn-ghost"
              }`}
            >
              {toggling ? "Updating..." : task.needs_help ? "Clear flag" : "Flag: need help"}
            </button>
          )}
          {canMarkDone && (
            <button
              onClick={markDone}
              disabled={completing}
              className="btn-verdict flex-1 rounded-xl py-3 text-sm font-extrabold disabled:opacity-50 active:scale-[0.98] transition-transform"
            >
              {completing ? "Marking..." : "Mark done"}
            </button>
          )}
        </section>

        {isOwner && pendingRequests.length > 0 && (
          <section className="rise rise-3 flex flex-col">
            <p className="label px-1 mb-1">Pending requests</p>
            <div className="flex flex-col">
              {pendingRequests.map((r) => {
                const u = userById.get(r.user_id);
                return (
                  <div key={r.id} className="list-row">
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <div className="avatar shrink-0">{u ? initials(u.display_name) : "?"}</div>
                      <p className="text-[13px] font-semibold truncate">{u?.display_name ?? "Unknown"} wants to join</p>
                    </div>
                    <div className="flex gap-1.5 shrink-0">
                      <button
                        onClick={() => respondJoin(r.user_id, true)}
                        className="btn-verdict rounded-lg px-2.5 py-1.5 text-[11px] font-extrabold"
                      >
                        Approve
                      </button>
                      <button
                        onClick={() => respondJoin(r.user_id, false)}
                        className="btn-danger rounded-lg px-2.5 py-1.5 text-[11px] font-bold"
                      >
                        Deny
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        <section className="rise rise-4 flex flex-col gap-2">
          <p className="label px-1">Progress notes</p>
          {notes.length === 0 && <p className="text-ink-dim text-sm py-4 text-center">No notes yet.</p>}
          {notes.length > 0 && (
            <div className="flex flex-col">
              {notes.map((n) => {
                const u = userById.get(n.user_id);
                return (
                  <div key={n.id} className="list-row items-start">
                    <div className="avatar shrink-0">{u ? initials(u.display_name) : "?"}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="text-[12.5px] font-bold">{u?.display_name ?? "Unknown"}</p>
                        <span className="text-[10px] text-ink-faint shrink-0">{timeAgo(n.created_at)}</span>
                      </div>
                      <p className="text-[12.5px] text-ink-dim mt-0.5 leading-snug">{n.body}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {canPostNote && (
            <div className="flex flex-col gap-2 mt-1">
              <textarea
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                placeholder="Leave a progress note..."
                rows={3}
                className="panel rounded-xl px-4 py-3 outline-none focus:border-ink/30 transition placeholder:text-ink-faint text-ink text-sm"
              />
              <button
                onClick={submitNote}
                disabled={posting || !noteText.trim()}
                className="btn-verdict rounded-xl py-2.5 text-sm font-extrabold disabled:opacity-50 active:scale-[0.98] transition-transform"
              >
                {posting ? "Posting..." : "Post note"}
              </button>
            </div>
          )}
        </section>

        {isOwner && task.status === "pending" && (
          <section className="rise rise-5">
            <button className="accordion-toggle" onClick={() => setShowExtend((v) => !v)}>
              <span>Request more time</span>
              <svg
                className={`accordion-chevron ${showExtend ? "open" : ""}`}
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                strokeWidth="2"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>

            {showExtend && (
              <div className="panel rounded-xl px-4 py-3 flex flex-col gap-2.5 mb-1">
                <textarea
                  value={extendReason}
                  onChange={(e) => setExtendReason(e.target.value)}
                  placeholder="What genuinely came up?"
                  rows={3}
                  className="panel-strong rounded-lg px-3 py-2.5 outline-none text-sm text-ink placeholder:text-ink-faint"
                />
                <input
                  type="datetime-local"
                  value={extendDueAt}
                  onChange={(e) => setExtendDueAt(e.target.value)}
                  className="panel-strong rounded-lg px-3 py-2.5 outline-none text-sm text-ink placeholder:text-ink-faint w-full min-w-0"
                />
                <div className="flex gap-2">
                  <button
                    onClick={submitExtend}
                    disabled={extending || !extendReason.trim() || !extendDueAt}
                    className="btn-verdict flex-1 rounded-lg py-2.5 text-xs font-extrabold disabled:opacity-50"
                  >
                    {extending ? "Judging..." : "Submit to Judge"}
                  </button>
                  <button onClick={() => setShowExtend(false)} className="btn-ghost rounded-lg px-3 text-xs font-bold">
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {latestExtension && latestExtension.ai_verdict && (
              <div className="panel rounded-lg px-3 py-2.5 flex flex-col gap-1 mt-1">
                <div className="ai-line">
                  <div className="ai-orb" />
                  <span>The Judge, ruling</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[12px] text-ink-dim leading-snug flex-1">{latestExtension.ai_reasoning}</p>
                  <span className="label text-[9px] px-2 py-1 rounded-full bg-surface-raised shrink-0">
                    {latestExtension.ai_verdict === "granted" ? "GRANTED" : "DENIED"}
                  </span>
                </div>
              </div>
            )}
          </section>
        )}
      </div>
      <BottomNav />
    </div>
  );
}
