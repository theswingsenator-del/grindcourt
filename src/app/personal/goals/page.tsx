"use client";

// Personal Goals — capture private tasks (manual or via the Assistant's
// natural-language parse) and see your own goals. No AI goal breakdown
// here (that's a Team-mode concept tied to daily-task generation against
// a shared docket) and no partner's goals section, obviously.

import { useMemo, useState } from "react";
import { useSession } from "@/lib/useSession";
import { useRealtimeQuery } from "@/lib/useRealtimeTable";
import { supabase } from "@/lib/supabase";
import { Goal, Task } from "@/lib/types";

interface GoalsData {
  goals: Goal[];
  tasks: Task[];
}

async function fetchPersonalGoals(userId: string | undefined): Promise<GoalsData> {
  if (!userId) return { goals: [], tasks: [] };
  const [{ data: goals }, { data: tasks }] = await Promise.all([
    supabase.from("goals").select("*").eq("owner_id", userId).eq("visibility", "personal").order("created_at", { ascending: false }),
    supabase.from("tasks").select("*").eq("owner_id", userId).eq("visibility", "personal"),
  ]);
  return { goals: goals ?? [], tasks: tasks ?? [] };
}

type MoreTab = "goal" | "assistant";

export default function PersonalGoalsPage() {
  const { appUser } = useSession();
  const { data, reload } = useRealtimeQuery(["goals", "tasks"], () => fetchPersonalGoals(appUser?.id), [appUser?.id]);

  const [newGoalTitle, setNewGoalTitle] = useState("");
  const [newGoalDate, setNewGoalDate] = useState("");
  const [creatingGoal, setCreatingGoal] = useState(false);

  const [manualTitle, setManualTitle] = useState("");
  const [manualDueAt, setManualDueAt] = useState("");
  const [manualGoalId, setManualGoalId] = useState("");
  const [manualAdding, setManualAdding] = useState(false);

  // primary, always-open capture form
  const [captureText, setCaptureText] = useState("");
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState("");
  const [draft, setDraft] = useState<{ title: string; due_at: string | null; goal_id: string | null; goal_title: string | null } | null>(null);
  const [addingDraft, setAddingDraft] = useState(false);

  // secondary forms — tucked behind an accordion, one tab visible at a time
  const [moreOpen, setMoreOpen] = useState(false);
  const [moreTab, setMoreTab] = useState<MoreTab>("goal");

  const goals = useMemo(() => data?.goals ?? [], [data]);

  function tasksForGoal(goalId: string): Task[] {
    return (data?.tasks ?? []).filter((t) => t.goal_id === goalId && t.approval_status === "approved");
  }

  async function createGoal() {
    if (!newGoalTitle.trim()) return;
    setCreatingGoal(true);
    await fetch("/api/goals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: newGoalTitle.trim(), target_date: newGoalDate || null, visibility: "personal" }),
    });
    setCreatingGoal(false);
    setNewGoalTitle("");
    setNewGoalDate("");
    reload();
  }

  async function addManualTask() {
    if (!manualTitle.trim()) return;
    setManualAdding(true);
    await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: manualTitle.trim(),
        due_at: manualDueAt || null,
        goal_id: manualGoalId || null,
        visibility: "personal",
      }),
    });
    setManualAdding(false);
    setManualTitle("");
    setManualDueAt("");
    setManualGoalId("");
    reload();
  }

  async function parseCapture() {
    if (!captureText.trim()) return;
    setParsing(true);
    setParseError("");
    setDraft(null);
    const res = await fetch("/api/tasks/parse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: captureText.trim() }),
    });
    const json = await res.json();
    setParsing(false);
    if (!res.ok) {
      setParseError(json.error ?? "Could not parse that. Try rephrasing.");
      return;
    }
    setDraft(json.draft);
  }

  async function confirmDraft() {
    if (!draft) return;
    setAddingDraft(true);
    await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: draft.title, due_at: draft.due_at, goal_id: draft.goal_id, visibility: "personal" }),
    });
    setAddingDraft(false);
    setDraft(null);
    setCaptureText("");
    reload();
  }

  // Boxless goal row — content + inline progress bar on the left, done
  // count on the right edge. Same pattern as Team's Goals screen.
  function GoalRow({ g }: { g: Goal }) {
    const tasks = tasksForGoal(g.id);
    const done = tasks.filter((t) => t.status === "done").length;
    const pct = tasks.length ? Math.round((done / tasks.length) * 100) : 0;
    return (
      <div className="list-row items-start">
        <div className="flex-1 min-w-0">
          <p className="font-bold text-[14px] text-ink">{g.title}</p>
          {g.target_date && <p className="text-[11px] text-ink-faint mt-0.5">Target: {g.target_date}</p>}
          <div className="bar mt-2.5">
            <div className="fill" style={{ width: `${pct}%` }} />
          </div>
        </div>
        <span className="text-[11px] text-ink-faint money shrink-0 mt-0.5">{done}/{tasks.length}</span>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col px-5 pt-2 pb-28 gap-5 max-w-md w-full mx-auto">
      <header className="rise rise-1">
        <p className="label mb-1">Goals</p>
        <h1 className="display-hero text-2xl">Your own targets. Nobody else sees these.</h1>
      </header>

      {/* Primary, always-open action — plain manual add, no AI, costs zero
          tokens. Swapped with the AI capture (now in the accordion below)
          per the explicit ask that a plain task-add should never have to
          touch the model. */}
      <section className="rise rise-2 panel rounded-2xl p-5 flex flex-col gap-3">
        <p className="label">Just add a task</p>
        <input
          value={manualTitle}
          onChange={(e) => setManualTitle(e.target.value)}
          placeholder="Task title"
          className="panel-strong rounded-xl px-4 py-3 outline-none focus:border-ink/30 transition placeholder:text-ink-faint text-ink text-sm"
        />
        <div className="flex gap-2 min-w-0">
          <input
            type="datetime-local"
            value={manualDueAt}
            onChange={(e) => setManualDueAt(e.target.value)}
            className="panel-strong rounded-xl px-2 py-3 outline-none focus:border-ink/30 transition text-ink text-[13px] flex-1 min-w-0"
          />
          <select
            value={manualGoalId}
            onChange={(e) => setManualGoalId(e.target.value)}
            className="panel-strong rounded-xl px-2 py-3 outline-none focus:border-ink/30 transition text-ink text-[13px] flex-1 min-w-0"
          >
            <option value="">No goal</option>
            {goals.map((g) => (
              <option key={g.id} value={g.id}>
                {g.title}
              </option>
            ))}
          </select>
        </div>
        <button
          onClick={addManualTask}
          disabled={manualAdding || !manualTitle.trim()}
          className="btn-verdict rounded-xl py-3 font-extrabold disabled:opacity-50 active:scale-[0.98] transition-transform"
        >
          {manualAdding ? "Adding..." : "Add task"}
        </button>
      </section>

      <section className="rise rise-3">
        <button className="accordion-toggle" onClick={() => setMoreOpen((v) => !v)}>
          <span>More ways to add</span>
          <svg className={`accordion-chevron ${moreOpen ? "open" : ""}`} width="14" height="14" viewBox="0 0 24 24" fill="none" strokeWidth="2" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>

        {moreOpen && (
          <div className="flex flex-col gap-3 pb-1">
            <div className="segpill-group self-start">
              <button className={`segpill ${moreTab === "goal" ? "active" : ""}`} onClick={() => setMoreTab("goal")}>
                New goal
              </button>
              <button className={`segpill ${moreTab === "assistant" ? "active" : ""}`} onClick={() => setMoreTab("assistant")}>
                Assistant
              </button>
            </div>

            {moreTab === "goal" && (
              <div className="panel rounded-2xl p-4 flex flex-col gap-3">
                <p className="text-[11px] text-ink-faint">Private — nobody else will ever see this.</p>
                <div className="flex gap-2 min-w-0">
                  <input
                    value={newGoalTitle}
                    onChange={(e) => setNewGoalTitle(e.target.value)}
                    placeholder="Goal title"
                    className="panel-strong rounded-lg px-3.5 py-2.5 outline-none focus:border-ink/30 transition placeholder:text-ink-faint text-ink text-sm flex-1 min-w-0"
                  />
                  <input
                    type="date"
                    value={newGoalDate}
                    onChange={(e) => setNewGoalDate(e.target.value)}
                    className="panel-strong rounded-lg px-2 py-2.5 outline-none focus:border-ink/30 transition text-ink text-[13px] w-32.5 shrink-0"
                  />
                </div>
                <button
                  onClick={createGoal}
                  disabled={creatingGoal || !newGoalTitle.trim()}
                  className="btn-ghost rounded-lg py-2.5 text-sm font-bold disabled:opacity-50 active:scale-[0.98] transition-transform"
                >
                  {creatingGoal ? "Creating..." : "Create goal"}
                </button>
              </div>
            )}

            {moreTab === "assistant" && (
              <div className="panel rounded-2xl p-4 flex flex-col gap-3">
                <div className="ai-line">
                  <div className="ai-orb" />
                  <span>The Assistant</span>
                </div>
                <p className="text-[11px] text-ink-faint -mt-1">Uses AI — for when a plain title isn&apos;t enough.</p>
                <textarea
                  value={captureText}
                  onChange={(e) => setCaptureText(e.target.value)}
                  placeholder="e.g. read 30 pages tonight before bed"
                  rows={2}
                  className="panel-strong rounded-xl px-4 py-3 outline-none focus:border-ink/30 transition placeholder:text-ink-faint text-ink text-sm"
                />
                <button
                  onClick={parseCapture}
                  disabled={parsing || !captureText.trim()}
                  className="btn-verdict rounded-xl py-3 font-extrabold disabled:opacity-50 active:scale-[0.98] transition-transform"
                >
                  {parsing ? "Structuring it..." : "Structure it"}
                </button>
                {parseError && (
                  <div className="flex flex-col gap-2">
                    <p className="text-sm font-semibold" style={{ color: "var(--red)" }}>{parseError}</p>
                    <button
                      onClick={async () => {
                        if (!captureText.trim()) return;
                        setAddingDraft(true);
                        await fetch("/api/tasks", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ title: captureText.trim(), due_at: null, goal_id: null, visibility: "personal" }),
                        });
                        setAddingDraft(false);
                        setCaptureText("");
                        reload();
                      }}
                      disabled={addingDraft || !captureText.trim()}
                      className="btn-ghost rounded-xl py-2.5 text-sm font-bold disabled:opacity-50 active:scale-[0.98] transition-transform"
                    >
                      {addingDraft ? "Adding..." : "Skip that — just add it as typed"}
                    </button>
                  </div>
                )}

                {draft && (
                  <div className="panel-strong rounded-xl p-4 flex flex-col gap-2.5 mt-1">
                    <input
                      value={draft.title}
                      onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                      className="bg-transparent outline-none text-ink font-semibold text-[14px] pb-2 w-full min-w-0"
                    />
                    <input
                      type="datetime-local"
                      value={draft.due_at ? draft.due_at.slice(0, 16) : ""}
                      onChange={(e) => setDraft({ ...draft, due_at: e.target.value || null })}
                      className="bg-transparent outline-none text-ink-dim text-sm w-full min-w-0"
                    />
                    {draft.goal_title && <p className="text-[11px] text-ink-faint">Linked to goal: {draft.goal_title}</p>}
                    <button
                      onClick={confirmDraft}
                      disabled={addingDraft || !draft.title.trim()}
                      className="btn-verdict rounded-xl py-2.5 font-extrabold disabled:opacity-50 active:scale-[0.98] transition-transform"
                    >
                      {addingDraft ? "Adding..." : "Add to private docket"}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </section>

      <section className="rise rise-4">
        <h2 className="text-[13px] font-bold text-ink-dim uppercase tracking-[0.08em] px-1 mb-1">Your goals</h2>
        {goals.length === 0 && (
          <div className="px-1 py-6 text-center">
            <p className="text-ink-dim text-sm font-medium">No private goals yet — just add tasks above.</p>
          </div>
        )}
        <div className="flex flex-col">
          {goals.map((g) => (
            <GoalRow key={g.id} g={g} />
          ))}
        </div>
      </section>
    </div>
  );
}
