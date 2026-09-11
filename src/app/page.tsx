"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSession } from "@/lib/useSession";
import { usePersonalMode } from "@/lib/PersonalModeContext";
import { useRealtimeQuery } from "@/lib/useRealtimeTable";
import { supabase } from "@/lib/supabase";
import { Task, Fine, TaskCollaborator, AppUser, Violation, EarningsLogEntry, SprintGoal } from "@/lib/types";
import { formatUsd, formatNaira } from "@/lib/fines";
import { friendlyTimezoneLabel } from "@/lib/tzLabel";
import { computeCleanStreak } from "@/lib/streaks";
import { violationLabel } from "@/lib/violationLabels";
import BottomNav from "@/components/BottomNav";
import InstallPrompt from "@/components/InstallPrompt";

interface BoardData {
  tasks: Task[];
  fines: Fine[];
  collaborators: TaskCollaborator[];
  users: AppUser[];
  violations: Violation[];
  earnings: EarningsLogEntry[];
  sprintGoal: SprintGoal | null;
}

async function fetchBoard(): Promise<BoardData> {
  const [{ data: tasks }, { data: fines }, { data: collaborators }, { data: users }, { data: violations }, { data: earnings }, { data: sprintGoals }] =
    await Promise.all([
      supabase.from("tasks").select("*").order("due_at", { ascending: true, nullsFirst: false }),
      supabase.from("fines").select("*").not("status", "in", "(paid_approved,waived)"),
      supabase.from("task_collaborators").select("*"),
      supabase.from("app_users").select("*"),
      supabase.from("violations").select("*"),
      supabase.from("earnings_log").select("*"),
      supabase.from("sprint_goal").select("*").order("created_at", { ascending: true }).limit(1),
    ]);
  return {
    tasks: tasks ?? [],
    fines: fines ?? [],
    collaborators: collaborators ?? [],
    users: users ?? [],
    violations: violations ?? [],
    earnings: earnings ?? [],
    sprintGoal: sprintGoals?.[0] ?? null,
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

const STATUS_LABEL: Record<string, string> = {
  issued: "ISSUED",
  bid_pending: "BID PENDING",
  accepted: "OWED",
  appealed: "APPEAL PENDING",
  paid_pending_proof: "AWAITING APPROVAL",
  paid_approved: "PAID",
  appeal_denied: "APPEAL DENIED",
  waived: "WAIVED",
};

interface ProfileFineHistory {
  lifetimePaid: number;
  countByStatus: Record<string, number>;
  recent: { fine: Fine; violationType: string | null }[];
}

// Feature 8 — fine history on avatar tap. Fetches its own data on open
// rather than folding into the main board fetch, since most sessions never
// open it and full fine history (including paid/waived) isn't otherwise
// needed on the dashboard.
function ProfileSheet({ user, onClose }: { user: AppUser; onClose: () => void }) {
  const [history, setHistory] = useState<ProfileFineHistory | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const [{ data: fines }, { data: violations }] = await Promise.all([
        supabase.from("fines").select("*").eq("user_id", user.id).order("created_at", { ascending: false }),
        supabase.from("violations").select("id,type").eq("user_id", user.id),
      ]);
      if (cancelled) return;
      const violationTypeById = new Map((violations ?? []).map((v: { id: string; type: string }) => [v.id, v.type]));
      const allFines: Fine[] = fines ?? [];
      const lifetimePaid = allFines.filter((f) => f.status === "paid_approved").reduce((sum, f) => sum + f.amount, 0);
      const countByStatus: Record<string, number> = {};
      for (const f of allFines) countByStatus[f.status] = (countByStatus[f.status] ?? 0) + 1;
      const recent = allFines.slice(0, 10).map((f) => ({ fine: f, violationType: violationTypeById.get(f.violation_id) ?? null }));
      setHistory({ lifetimePaid, countByStatus, recent });
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [user.id]);

  return (
    <div className="fixed inset-0 z-[60] bg-black/75 backdrop-blur-sm flex items-end" onClick={onClose}>
      <div
        className="w-full max-w-md mx-auto panel-strong rounded-t-3xl px-6 pt-6 pb-[calc(2rem+env(safe-area-inset-bottom))] max-h-[80vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-10 h-1 rounded-full bg-ink-faint/30 mx-auto mb-5" />
        <div className="flex items-center gap-2.5 mb-4">
          <div className="avatar w-9 h-9 text-xs">{initials(user.display_name)}</div>
          <h2 className="display text-lg font-bold">{user.display_name}</h2>
        </div>

        {!history && (
          <div className="flex justify-center py-8">
            <div className="w-7 h-7 rounded-full border-2 border-ink-faint/25 border-t-ink animate-spin" />
          </div>
        )}

        {history && (
          <div className="flex flex-col gap-4">
            <div className="stat-row">
              <div className="flex flex-col gap-0.5">
                <span className="label">Lifetime paid</span>
                <span className="money stat-num text-2xl text-red">{formatNaira(history.lifetimePaid)}</span>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {Object.entries(history.countByStatus).map(([status, count]) => (
                <span key={status} className="label text-[9px] px-2.5 py-1.5 rounded-full bg-surface-raised">
                  {STATUS_LABEL[status] ?? status}: {count}
                </span>
              ))}
              {Object.keys(history.countByStatus).length === 0 && <p className="text-ink-dim text-sm">No fines on record.</p>}
            </div>

            {history.recent.length > 0 && (
              <div className="flex flex-col gap-2">
                <p className="label px-0.5">Recent history</p>
                {history.recent.map(({ fine, violationType }) => (
                  <div key={fine.id} className="panel rounded-xl px-3.5 py-3 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-[12.5px] font-semibold truncate">
                        {violationType ? violationLabel(violationType as Violation["type"]) : "violation"}
                      </p>
                      <p className="text-[10.5px] text-ink-faint mt-0.5">
                        {new Date(fine.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                        {" · "}
                        {STATUS_LABEL[fine.status] ?? fine.status}
                      </p>
                    </div>
                    <p className="money text-sm font-bold shrink-0">{formatNaira(fine.amount)}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// Boxless list row — content left (title, due date, badges, collaborator
// avatars), primary action/status on the RIGHT edge. This is the
// deliberate compositional flip from the old left-checkbox card: no panel
// wrapper, rows separate with a hairline (.list-row in globals.css).
function TaskRow({
  task,
  isMine,
  approvedCollabs,
  userById,
  pendingBadge,
  onComplete,
  onDispute,
}: {
  task: Task;
  isMine: boolean;
  approvedCollabs: TaskCollaborator[];
  userById: Map<string, AppUser>;
  pendingBadge: string | null;
  onComplete: () => void;
  onDispute: () => void;
}) {
  const overdue = task.status === "pending" && task.due_at && new Date(task.due_at) < new Date();
  const canToggle = isMine && task.status !== "done";
  return (
    <div className="list-row">
      <div className="flex-1 min-w-0">
        <Link href={`/task/${task.id}`} className="block">
          <p className={`text-[13.5px] font-semibold leading-snug ${task.status === "done" ? "line-through text-ink-faint" : "text-ink"}`}>
            {task.title}
          </p>
        </Link>
        {task.due_at && (
          <p className={`text-[11px] mt-0.5 ${overdue ? "text-red font-bold" : "text-ink-faint"}`}>
            Due {new Date(task.due_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
            {overdue ? " — OVERDUE" : ""}
          </p>
        )}
        {task.is_disputed && !task.dispute_resolved && (
          <p className="text-[11px] mt-0.5 text-ink font-bold">DISPUTED — under review</p>
        )}
        {task.needs_help && <p className="text-[11px] mt-0.5 text-red font-bold uppercase tracking-wide">Needs help</p>}
        {pendingBadge && <p className="text-[11px] mt-0.5 text-amber font-bold">{pendingBadge}</p>}
        {approvedCollabs.length > 0 && (
          <div className="flex items-center gap-1 mt-1.5">
            {approvedCollabs.map((c) => {
              const u = userById.get(c.user_id);
              return (
                <div key={c.id} className="avatar w-[19px] h-[19px] text-[8px]" title={u?.display_name}>
                  {u ? initials(u.display_name) : "?"}
                </div>
              );
            })}
          </div>
        )}
      </div>
      <div className="shrink-0 flex items-center gap-2">
        {!isMine && task.status === "done" && !task.is_disputed && (
          <button onClick={onDispute} className="btn-ghost rounded-lg px-2.5 py-1.5 text-[11px] font-bold active:scale-95 transition-transform">
            Dispute
          </button>
        )}
        {isMine && task.status !== "done" && (
          <button onClick={onComplete} className="btn-verdict rounded-lg px-2.5 py-1.5 text-[11px] font-extrabold active:scale-95 transition-transform">
            Done
          </button>
        )}
        <button
          type="button"
          onClick={canToggle ? onComplete : undefined}
          disabled={!canToggle}
          aria-label={canToggle ? "Mark task done" : task.status === "done" ? "Task done" : undefined}
          className={`-m-2 p-2 flex items-center justify-center transition-transform ${canToggle ? "active:scale-90 cursor-pointer" : ""}`}
        >
          <span
            className={`w-6 h-6 rounded-md border flex items-center justify-center ${
              task.status === "done" ? "bg-verdict border-verdict" : overdue ? "border-red" : "border-ink-faint"
            }`}
          >
            {task.status === "done" && <span className="text-[11px] text-black font-bold">✓</span>}
          </span>
        </button>
      </div>
    </div>
  );
}

// Hero ring — the ONE dominant stat on the dashboard (day-count). Large
// centered ring (~148px) with the number set inside it. Approved-
// composition rule #1.
function HeroRing({ value, label, pct }: { value: string | number; label: string; pct: number }) {
  const size = 148;
  const r = 64;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(1, pct));
  const dash = c * clamped;
  return (
    <div className="ring-hero">
      <div className="relative" style={{ width: size, height: size }}>
        <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-raised)" strokeWidth="9" />
          {clamped > 0 && (
            <circle
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke="var(--accent)"
              strokeWidth="9"
              strokeLinecap="round"
              strokeDasharray={`${dash} ${c}`}
            />
          )}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="stat-num text-[42px] leading-none">{value}</span>
          <span className="label mt-1.5">{label}</span>
        </div>
      </div>
    </div>
  );
}

function IconGlobe() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" strokeWidth="1.8" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17M12 3.5c2.6 2.4 4 5.4 4 8.5s-1.4 6.1-4 8.5c-2.6-2.4-4-5.4-4-8.5s1.4-6.1 4-8.5z" />
    </svg>
  );
}

export default function Dashboard() {
  const { appUser, partner, loading: sessionLoading } = useSession();
  const { goPersonal } = usePersonalMode();
  const { data, reload, setData } = useRealtimeQuery(
    ["tasks", "goals", "fines", "violations", "task_collaborators", "earnings_log", "sprint_goal"],
    fetchBoard
  );
  const [disputeTask, setDisputeTask] = useState<Task | null>(null);
  const [disputeReason, setDisputeReason] = useState("");
  const [disputing, setDisputing] = useState(false);
  const [streak, setStreak] = useState<number | null>(null);
  const [profileUser, setProfileUser] = useState<AppUser | null>(null);

  // Logging an earning belongs next to the sprint bar it feeds, not
  // tangled into Goals' "create a goal/task" menu — moved here.
  const [logEarningOpen, setLogEarningOpen] = useState(false);
  const [earningAmount, setEarningAmount] = useState("");
  const [earningNote, setEarningNote] = useState("");
  const [earningAdding, setEarningAdding] = useState(false);

  async function logEarning() {
    const amount = Number(earningAmount);
    if (!amount || amount <= 0) return;
    setEarningAdding(true);
    await fetch("/api/earnings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount_usd: amount, note: earningNote.trim() || null }),
    });
    setEarningAdding(false);
    setEarningAmount("");
    setEarningNote("");
    setLogEarningOpen(false);
    reload();
  }

  useEffect(() => {
    let cancelled = false;
    if (!appUser) return;
    computeCleanStreak(supabase, appUser).then((n) => {
      if (!cancelled) setStreak(n);
    });
    return () => {
      cancelled = true;
    };
  }, [appUser, data?.violations]);

  const myTasks = useMemo(
    () => (data?.tasks ?? []).filter((t) => t.owner_id === appUser?.id && t.approval_status === "approved" && t.visibility === "partner"),
    [data, appUser]
  );
  const partnerTasks = useMemo(
    () => (data?.tasks ?? []).filter((t) => t.owner_id === partner?.id && t.approval_status === "approved" && t.visibility === "partner"),
    [data, partner]
  );
  const myOpenFines = useMemo(() => (data?.fines ?? []).filter((f) => f.user_id === appUser?.id), [data, appUser]);

  const combinedEarnings = useMemo(() => (data?.earnings ?? []).reduce((sum, e) => sum + e.amount_usd, 0), [data]);
  const sprintGoal = data?.sprintGoal ?? null;
  const sprintProgressPct = sprintGoal && sprintGoal.target_usd > 0 ? Math.min(100, Math.round((combinedEarnings / sprintGoal.target_usd) * 100)) : 0;

  const userById = useMemo(() => {
    const map = new Map<string, AppUser>();
    for (const u of data?.users ?? []) map.set(u.id, u);
    return map;
  }, [data]);

  const approvedCollabsByTask = useMemo(() => {
    const map = new Map<string, TaskCollaborator[]>();
    for (const c of data?.collaborators ?? []) {
      if (c.status !== "approved") continue;
      const arr = map.get(c.task_id) ?? [];
      arr.push(c);
      map.set(c.task_id, arr);
    }
    return map;
  }, [data]);

  function pendingBadgeFor(task: Task): string | null {
    if (!appUser) return null;
    const collabs = (data?.collaborators ?? []).filter((c) => c.task_id === task.id && c.status === "requested");
    if (task.owner_id === appUser.id && collabs.length > 0) {
      return `${collabs.length} pending join request${collabs.length > 1 ? "s" : ""}`;
    }
    const mine = collabs.find((c) => c.user_id === appUser.id);
    if (mine) return "Your join request is pending";
    return null;
  }

  const dayNumber = useMemo(() => {
    if (!appUser?.created_at) return 1;
    const start = new Date(appUser.created_at);
    start.setHours(0, 0, 0, 0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return Math.max(1, Math.floor((today.getTime() - start.getTime()) / 86400000) + 1);
  }, [appUser]);

  const doneToday = useMemo(() => {
    if (!appUser) return 0;
    const todayStr = new Date().toDateString();
    const doneTasksToday = (data?.tasks ?? []).filter(
      (t) => t.status === "done" && t.completed_at && new Date(t.completed_at).toDateString() === todayStr && t.visibility === "partner"
    );
    return doneTasksToday.filter((t) => {
      if (t.owner_id === appUser.id) return true;
      const collabs = approvedCollabsByTask.get(t.id) ?? [];
      return collabs.some((c) => c.user_id === appUser.id);
    }).length;
  }, [data, appUser, approvedCollabsByTask]);

  async function completeTask(id: string) {
    // Flip the checkbox instantly — the round trip to confirm is what made
    // this feel slow. reload() (real data) reconciles right behind it; on
    // failure we revert so it never lies about what actually happened.
    setData((prev) =>
      prev
        ? {
            ...prev,
            tasks: prev.tasks.map((t) =>
              t.id === id ? { ...t, status: "done", completed_at: new Date().toISOString() } : t
            ),
          }
        : prev
    );

    const res = await fetch("/api/tasks", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status: "done" }),
    });
    if (!res.ok) {
      if (res.status === 401) {
        window.location.reload();
        return;
      }
      alert("Couldn't mark that done — try again.");
      reload();
      return;
    }
    reload();
  }

  async function submitDispute() {
    if (!disputeTask || !disputeReason.trim()) return;
    setDisputing(true);
    await fetch("/api/tasks/dispute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task_id: disputeTask.id, reason: disputeReason.trim() }),
    });
    setDisputing(false);
    setDisputeTask(null);
    setDisputeReason("");
    reload();
  }

  if (sessionLoading || !data) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4">
        <div className="w-9 h-9 rounded-full border-2 border-ink-faint/25 border-t-ink animate-spin" />
        <p className="text-ink-faint text-sm">Convening the court...</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col">
      <div className="flex-1 flex flex-col px-5 pt-[calc(1.4rem+env(safe-area-inset-top))] pb-28 gap-5 max-w-md w-full mx-auto">
        <header className="rise rise-1 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icons/icon-192.png" alt="" className="w-8 h-8 rounded-lg shrink-0" />
            <div className="min-w-0">
              <p className="text-[13px] font-bold leading-none display">GrindCourt</p>
              <p className="label mt-1 truncate">
                {appUser?.display_name ?? "On the record"}
                {appUser?.timezone && <span className="text-ink-faint"> · resets 12AM {friendlyTimezoneLabel(appUser.timezone)}</span>}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={goPersonal}
              aria-label="Switch to Personal mode"
              className="btn-ghost rounded-full p-2.5 flex items-center justify-center active:scale-90 transition-transform"
            >
              <IconGlobe />
            </button>
            {myOpenFines.length > 0 && (
              <Link href="/ledger" className="rounded-full px-3 py-1.5 flex items-center gap-1.5 pulse-alert" style={{ background: "color-mix(in srgb, var(--danger) 16%, var(--surface))" }}>
                <span className="text-[13px]">⚖</span>
                <span className="text-sm font-extrabold money text-red">{myOpenFines.length}</span>
              </Link>
            )}
          </div>
        </header>

        {/* Rule #1 — one dominant hero ring (day-count), everything else
            drops to a single quiet inline text line underneath. */}
        <div className="rise rise-2 flex flex-col items-center gap-3">
          <HeroRing value={dayNumber} label="Day" pct={((dayNumber - 1) % 7 + 1) / 7} />
          <p className="stat-inline">
            <b>{doneToday}</b> done<span className="sep">·</span>
            <b className={myOpenFines.length > 0 ? "text-red" : undefined}>{myOpenFines.length}</b> fine{myOpenFines.length === 1 ? "" : "s"}
            <span className="sep">·</span>
            <b>{streak === null ? "—" : streak}</b> streak
          </p>
        </div>

        {/* Rule #2 — horizontal-scrolling carousel, not stacked cards. The
            Assistant is the higher-frequency action so it gets the solid
            accent-fill treatment; Talk to the Judge stays a quiet dark card
            with an accent-colored icon dot. */}
        <div className="rise rise-2 carousel">
          <Link
            href="/assistant"
            className="carousel-card rounded-2xl p-4 flex flex-col justify-between gap-6 active:scale-[0.98] transition-transform min-h-[128px]"
            style={{ background: "var(--accent)" }}
          >
            <div className="w-9 h-9 rounded-full flex items-center justify-center" style={{ background: "color-mix(in srgb, var(--accent-ink) 14%, transparent)" }}>
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: "var(--accent-ink)" }} />
            </div>
            <div>
              <p className="text-[13.5px] font-extrabold" style={{ color: "var(--accent-ink)" }}>The Assistant</p>
              <p className="text-[10.5px] mt-0.5 leading-snug" style={{ color: "color-mix(in srgb, var(--accent-ink) 75%, transparent)" }}>
                Describe it, I&apos;ll structure it.
              </p>
            </div>
          </Link>
          <Link href="/talk" className="carousel-card panel rounded-2xl p-4 flex flex-col justify-between gap-6 active:scale-[0.98] transition-transform min-h-[128px]">
            <div className="w-9 h-9 rounded-full flex items-center justify-center" style={{ background: "color-mix(in srgb, var(--accent) 18%, transparent)" }}>
              <div className="ai-orb" style={{ width: 16, height: 16, boxShadow: "none" }} />
            </div>
            <div>
              <p className="text-[13px] font-bold text-ink">Talk to the Judge</p>
              <p className="text-[10.5px] text-ink-dim mt-0.5 leading-snug">Reassign or edit a task by saying so.</p>
            </div>
          </Link>
        </div>

        {/* Rule #5 — progress bar sits inline under its own section heading,
            no .panel wrapper. */}
        {sprintGoal && (
          <section className="rise rise-2 progress-inline">
            <div className="flex items-center justify-between px-0.5">
              <p className="label">{sprintGoal.label}</p>
              <span className="money text-[11px] text-ink-dim">
                {formatUsd(combinedEarnings)} / {formatUsd(sprintGoal.target_usd)}
              </span>
            </div>
            <div className="bar">
              <div className="fill" style={{ width: `${sprintProgressPct}%` }} />
            </div>
            {!logEarningOpen ? (
              <button
                onClick={() => setLogEarningOpen(true)}
                className="text-[11px] text-ink-faint font-bold mt-1.5 px-0.5"
              >
                + Log earning
              </button>
            ) : (
              <div className="flex flex-col gap-2 mt-2">
                <div className="flex gap-2 min-w-0">
                  <input
                    type="number"
                    value={earningAmount}
                    onChange={(e) => setEarningAmount(e.target.value)}
                    placeholder="Amount ($)"
                    className="panel rounded-lg px-3 py-2 outline-none focus:border-ink/30 transition placeholder:text-ink-faint text-ink text-[13px] flex-1 min-w-0"
                  />
                  <input
                    value={earningNote}
                    onChange={(e) => setEarningNote(e.target.value)}
                    placeholder="For what? (optional)"
                    className="panel rounded-lg px-3 py-2 outline-none focus:border-ink/30 transition placeholder:text-ink-faint text-ink text-[13px] flex-1 min-w-0"
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={logEarning}
                    disabled={earningAdding || !earningAmount}
                    className="btn-verdict rounded-lg py-2 text-xs font-extrabold disabled:opacity-50 flex-1"
                  >
                    {earningAdding ? "Logging..." : "Log it"}
                  </button>
                  <button
                    onClick={() => setLogEarningOpen(false)}
                    className="btn-ghost rounded-lg px-3 text-xs font-bold"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </section>
        )}

        {/* Rule #3 — boxless list rows for the docket, hairline-separated,
            action/checkbox moved to the right edge (see <TaskRow>). */}
        <section className="rise rise-3">
          <div className="flex items-center justify-between mb-1 px-1">
            <button onClick={() => appUser && setProfileUser(appUser)} className="flex items-center gap-2">
              {appUser && <div className="avatar w-6 h-6 text-[9px]">{initials(appUser.display_name)}</div>}
              <h2 className="text-[13px] font-bold text-ink-dim uppercase tracking-[0.08em]">Your docket</h2>
            </button>
            <div className="flex items-center gap-3">
              <Link href="/goals" className="text-ink-dim text-xs font-bold">+ Add task</Link>
            </div>
          </div>
          <div className="flex flex-col">
            {myTasks.length === 0 && (
              <div className="px-1 py-6 text-center">
                <p className="text-ink-dim text-sm font-medium">No tasks on your docket.</p>
              </div>
            )}
            {myTasks.map((t) => (
              <TaskRow
                key={t.id}
                task={t}
                isMine
                approvedCollabs={approvedCollabsByTask.get(t.id) ?? []}
                userById={userById}
                pendingBadge={pendingBadgeFor(t)}
                onComplete={() => completeTask(t.id)}
                onDispute={() => {}}
              />
            ))}
          </div>
        </section>

        <section className="rise rise-4">
          <div className="flex items-center justify-between mb-1 px-1">
            <button onClick={() => partner && setProfileUser(partner)} className="flex items-center gap-2">
              {partner && <div className="avatar w-6 h-6 text-[9px]">{initials(partner.display_name)}</div>}
              <h2 className="text-[13px] font-bold text-ink-dim uppercase tracking-[0.08em]">
                {partner?.display_name ?? "Partner"}&apos;s docket
              </h2>
            </button>
          </div>
          <div className="flex flex-col">
            {partnerTasks.length === 0 && (
              <div className="px-1 py-6 text-center">
                <p className="text-ink-dim text-sm font-medium">Nothing on record yet.</p>
              </div>
            )}
            {partnerTasks.map((t) => (
              <TaskRow
                key={t.id}
                task={t}
                isMine={false}
                approvedCollabs={approvedCollabsByTask.get(t.id) ?? []}
                userById={userById}
                pendingBadge={pendingBadgeFor(t)}
                onComplete={() => {}}
                onDispute={() => setDisputeTask(t)}
              />
            ))}
          </div>
        </section>
      </div>

      {disputeTask && (
        <div className="fixed inset-0 z-[60] bg-black/75 backdrop-blur-sm flex items-end" onClick={() => setDisputeTask(null)}>
          <div
            className="w-full max-w-md mx-auto panel-strong rounded-t-3xl px-6 pt-6 pb-[calc(2rem+env(safe-area-inset-bottom))]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-10 h-1 rounded-full bg-ink-faint/30 mx-auto mb-5" />
            <p className="label mb-2">Dispute completion</p>
            <h2 className="display text-lg font-bold mb-4">&ldquo;{disputeTask.title}&rdquo;</h2>
            <textarea
              value={disputeReason}
              onChange={(e) => setDisputeReason(e.target.value)}
              placeholder="Why do you believe this wasn't genuinely done?"
              rows={4}
              className="w-full panel rounded-xl px-4 py-3 outline-none focus:border-ink/30 transition placeholder:text-ink-faint text-ink text-sm"
            />
            <button
              onClick={submitDispute}
              disabled={disputing || !disputeReason.trim()}
              className="btn-danger mt-4 w-full rounded-xl py-3.5 font-extrabold disabled:opacity-50 active:scale-[0.98] transition-transform"
            >
              {disputing ? "Filing..." : "File dispute"}
            </button>
            <button onClick={() => setDisputeTask(null)} className="mt-2 w-full py-2.5 text-sm font-bold text-ink-dim">
              Cancel
            </button>
          </div>
        </div>
      )}

      {profileUser && <ProfileSheet user={profileUser} onClose={() => setProfileUser(null)} />}

      <InstallPrompt />
      <BottomNav />
    </div>
  );
}
