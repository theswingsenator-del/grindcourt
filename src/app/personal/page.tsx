"use client";

// Personal Docket — the Personal globe's home screen. Deliberately NOT a
// filtered re-render of the Team dashboard: no partner docket, no fines
// badge, no "Talk to the Judge" (there's no judge here, no one to dispute
// with), no ProfileSheet. Just your own private tasks and the Assistant.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSession } from "@/lib/useSession";
import { useRealtimeQuery } from "@/lib/useRealtimeTable";
import { supabase } from "@/lib/supabase";
import { Task } from "@/lib/types";
import { friendlyTimezoneLabel } from "@/lib/tzLabel";
import { computeCleanStreak } from "@/lib/streaks";

interface PersonalBoardData {
  tasks: Task[];
}

async function fetchPersonalBoard(userId: string | undefined): Promise<PersonalBoardData> {
  if (!userId) return { tasks: [] };
  const { data: tasks } = await supabase
    .from("tasks")
    .select("*")
    .eq("owner_id", userId)
    .eq("visibility", "personal")
    .order("due_at", { ascending: true, nullsFirst: false });
  return { tasks: tasks ?? [] };
}

function initials(name: string): string {
  return name.split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase();
}

// Hero ring — the one dominant stat on this screen (day-count), matching
// Team's <HeroRing> in src/app/page.tsx. Duplicated locally rather than
// shared to keep the Team/Personal route trees fully independent per the
// project's "two globes" rule; reads var(--accent), which .personal-scope
// already re-layers to the blue-violet hue, so it recolors for free.
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
            <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--accent)" strokeWidth="9" strokeLinecap="round" strokeDasharray={`${dash} ${c}`} />
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

// Boxless list row — content left, primary action/status on the right edge
// (the compositional flip from the old left-checkbox layout). No panel
// wrapper; rows separate with a hairline via .list-row (globals.css).
function TaskRow({ task, onComplete }: { task: Task; onComplete: () => void }) {
  const overdue = task.status === "pending" && task.due_at && new Date(task.due_at) < new Date();
  const canToggle = task.status !== "done";
  return (
    <div className="list-row">
      <div className="flex-1 min-w-0">
        <p className={`text-[13.5px] font-semibold leading-snug ${task.status === "done" ? "line-through text-ink-faint" : "text-ink"}`}>
          {task.title}
        </p>
        {task.due_at && (
          <p className={`text-[11px] mt-0.5 ${overdue ? "font-bold" : "text-ink-faint"}`} style={overdue ? { color: "var(--red)" } : undefined}>
            Due {new Date(task.due_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
            {overdue ? " — overdue" : ""}
          </p>
        )}
      </div>
      <div className="shrink-0 flex items-center gap-2">
        {task.status !== "done" && (
          <button
            onClick={onComplete}
            className="btn-verdict rounded-lg px-2.5 py-1.5 text-[11px] font-extrabold active:scale-95 transition-transform"
          >
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
            className="w-6 h-6 rounded-md border flex items-center justify-center"
            style={{
              background: task.status === "done" ? "var(--accent)" : "transparent",
              borderColor: task.status === "done" ? "var(--accent)" : overdue ? "var(--danger)" : "var(--ink-faint)",
            }}
          >
            {task.status === "done" && <span className="text-[11px] font-bold" style={{ color: "var(--accent-ink)" }}>✓</span>}
          </span>
        </button>
      </div>
    </div>
  );
}

export default function PersonalDocket() {
  const { appUser, loading: sessionLoading } = useSession();
  const { data, reload, setData } = useRealtimeQuery(["tasks"], () => fetchPersonalBoard(appUser?.id), [appUser?.id]);
  const [streak, setStreak] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!appUser) return;
    computeCleanStreak(supabase, appUser).then((n) => {
      if (!cancelled) setStreak(n);
    });
    return () => {
      cancelled = true;
    };
  }, [appUser]);

  const tasks = useMemo(() => (data?.tasks ?? []).filter((t) => t.approval_status === "approved"), [data]);

  const dayNumber = useMemo(() => {
    if (!appUser?.created_at) return 1;
    const start = new Date(appUser.created_at);
    start.setHours(0, 0, 0, 0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return Math.max(1, Math.floor((today.getTime() - start.getTime()) / 86400000) + 1);
  }, [appUser]);

  const doneToday = useMemo(() => {
    const todayStr = new Date().toDateString();
    return tasks.filter((t) => t.status === "done" && t.completed_at && new Date(t.completed_at).toDateString() === todayStr).length;
  }, [tasks]);

  async function completeTask(id: string) {
    setData((prev) =>
      prev ? { ...prev, tasks: prev.tasks.map((t) => (t.id === id ? { ...t, status: "done", completed_at: new Date().toISOString() } : t)) } : prev
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
      reload();
      return;
    }
    reload();
  }

  if (sessionLoading || !data) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4">
        <div className="w-9 h-9 rounded-full border-2 border-ink-faint/25 border-t-ink animate-spin" />
        <p className="text-ink-faint text-sm">Opening your space...</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col px-5 pt-2 pb-28 gap-5 max-w-md w-full mx-auto">
      <header className="rise rise-1">
        <div className="flex items-center gap-2.5">
          {appUser && (
            <div className="avatar w-9 h-9 text-xs" style={{ background: "var(--surface2)", borderColor: "var(--line)" }}>
              {initials(appUser.display_name)}
            </div>
          )}
          <div>
            <h1 className="display-hero text-2xl">Just yours.</h1>
            <p className="label mt-1">
              {appUser?.display_name ?? "On the record"}
              {appUser?.timezone && <span className="text-ink-faint"> · resets 12AM {friendlyTimezoneLabel(appUser.timezone)}</span>}
            </p>
          </div>
        </div>
      </header>

      {/* Rule #1 — one dominant hero ring, secondary stats drop to a quiet
          inline text line. */}
      <div className="rise rise-2 flex flex-col items-center gap-3">
        <HeroRing value={dayNumber} label="Day" pct={((dayNumber - 1) % 7 + 1) / 7} />
        <p className="stat-inline">
          <b>{doneToday}</b> done today<span className="sep">·</span>
          <b>{streak === null ? "—" : streak}</b> streak
        </p>
      </div>

      {/* Rule #2 — carousel row for entry points (only one card here today,
          but this is the same swipeable-row treatment Team's dashboard
          uses, not a full-width stacked card). Primary action = solid
          accent fill. */}
      <div className="rise rise-2 carousel">
        <Link
          href="/personal/assistant"
          className="carousel-card rounded-2xl p-4 flex flex-col justify-between gap-6 active:scale-[0.98] transition-transform min-h-32"
          style={{ background: "var(--accent)" }}
        >
          <div className="w-9 h-9 rounded-full flex items-center justify-center" style={{ background: "color-mix(in srgb, var(--accent-ink) 14%, transparent)" }}>
            <span className="w-2.5 h-2.5 rounded-full" style={{ background: "var(--accent-ink)" }} />
          </div>
          <div>
            <p className="text-[13.5px] font-extrabold" style={{ color: "var(--accent-ink)" }}>The Assistant</p>
            <p className="text-[10.5px] mt-0.5 leading-snug" style={{ color: "color-mix(in srgb, var(--accent-ink) 75%, transparent)" }}>
              Describe it — private, just for you.
            </p>
          </div>
        </Link>
      </div>

      {/* Rule #3 — boxless list rows, hairline-separated. */}
      <section className="rise rise-3">
        <div className="flex items-center justify-between mb-1 px-1">
          <h2 className="text-[13px] font-bold text-ink-dim uppercase tracking-[0.08em]">Your private docket</h2>
          <Link href="/personal/goals" className="text-ink-dim text-xs font-bold">+ Add task</Link>
        </div>
        <div className="flex flex-col">
          {tasks.length === 0 && (
            <div className="px-1 py-6 text-center">
              <p className="text-ink-dim text-sm font-medium">Nothing private on your docket.</p>
            </div>
          )}
          {tasks.map((t) => (
            <TaskRow key={t.id} task={t} onComplete={() => completeTask(t.id)} />
          ))}
        </div>
      </section>
    </div>
  );
}
