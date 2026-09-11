"use client";

import { useMemo, useState } from "react";
import { useSession } from "@/lib/useSession";
import { useRealtimeQuery } from "@/lib/useRealtimeTable";
import { supabase } from "@/lib/supabase";
import { Goal, Task } from "@/lib/types";
import BottomNav from "@/components/BottomNav";

interface GoalsData {
  goals: Goal[];
  tasks: Task[];
}

async function fetchGoals(): Promise<GoalsData> {
  const [{ data: goals }, { data: tasks }] = await Promise.all([
    supabase.from("goals").select("*").order("created_at", { ascending: false }),
    supabase.from("tasks").select("*"),
  ]);
  return { goals: goals ?? [], tasks: tasks ?? [] };
}

type MoreTab = "goal" | "assistant";

export default function GoalsPage() {
  const { appUser, partner } = useSession();
  const { data, reload } = useRealtimeQuery(["goals", "tasks"], fetchGoals);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [breaking, setBreaking] = useState(false);
  const [error, setError] = useState("");
  const [lastCreatedCount, setLastCreatedCount] = useState<number | null>(null);

  // natural-language task capture — describe it loosely, the Planner
  // structures it, you review/edit before it's actually added. This is now
  // the ONE always-open form on this screen (the primary action); every
  // other "create X" form below tucks behind the "More ways to add"
  // accordion instead of sitting open on the page at once.
  const [captureText, setCaptureText] = useState("");
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState("");
  const [draft, setDraft] = useState<{ title: string; due_at: string | null; goal_id: string | null; goal_title: string | null } | null>(null);
  const [addingDraft, setAddingDraft] = useState(false);

  // secondary forms — collapsed by default, revealed one at a time via the
  // "More ways to add" accordion + its internal segmented tabs.
  const [moreOpen, setMoreOpen] = useState(false);
  const [moreTab, setMoreTab] = useState<MoreTab>("goal");

  const [creatingGoal, setCreatingGoal] = useState(false);

  const [manualTitle, setManualTitle] = useState("");
  const [manualDueAt, setManualDueAt] = useState("");
  const [manualGoalId, setManualGoalId] = useState("");
  const [manualBlockedBy, setManualBlockedBy] = useState("");
  const [manualAdding, setManualAdding] = useState(false);

  const myGoals = useMemo(
    () => (data?.goals ?? []).filter((g) => g.owner_id === appUser?.id && g.visibility === "partner"),
    [data, appUser]
  );
  const partnerGoals = useMemo(
    () => (data?.goals ?? []).filter((g) => g.owner_id === partner?.id && g.visibility === "partner"),
    [data, partner]
  );
  const visibilityWanted = "partner";
  const myOpenTasks = useMemo(
    () =>
      (data?.tasks ?? []).filter(
        (t) => t.owner_id === appUser?.id && t.status !== "done" && t.approval_status === "approved" && t.visibility === visibilityWanted
      ),
    [data, appUser, visibilityWanted]
  );

  async function breakDown() {
    if (!title.trim()) return;
    setBreaking(true);
    setError("");
    setLastCreatedCount(null);
    const res = await fetch("/api/goals/breakdown", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: title.trim(), description: description.trim(), target_date: targetDate || null }),
    });
    const json = await res.json();
    setBreaking(false);
    if (!res.ok) {
      setError(json.error ?? "Breakdown failed. Try again.");
      return;
    }
    setLastCreatedCount(json.tasks?.length ?? 0);
    setTitle("");
    setDescription("");
    setTargetDate("");
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
      body: JSON.stringify({ title: draft.title, due_at: draft.due_at, goal_id: draft.goal_id, visibility: visibilityWanted }),
    });
    setAddingDraft(false);
    setDraft(null);
    setCaptureText("");
    reload();
  }

  async function createGoal() {
    if (!title.trim()) return;
    setCreatingGoal(true);
    await fetch("/api/goals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: title.trim(), description: description.trim() || null, target_date: targetDate || null }),
    });
    setCreatingGoal(false);
    setTitle("");
    setDescription("");
    setTargetDate("");
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
        blocked_by_task_id: manualBlockedBy || null,
        visibility: visibilityWanted,
      }),
    });
    setManualAdding(false);
    setManualTitle("");
    setManualDueAt("");
    setManualGoalId("");
    setManualBlockedBy("");
    reload();
  }

  function tasksForGoal(goalId: string): Task[] {
    return (data?.tasks ?? []).filter((t) => t.goal_id === goalId && t.approval_status === "approved" && t.visibility === visibilityWanted);
  }

  // Boxless goal row — content + inline progress bar on the left, done
  // count on the right edge. Replaces the old per-goal boxed panel card.
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
        <span className="text-[11px] text-ink-faint money shrink-0 mt-0.5">
          {done}/{tasks.length}
        </span>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col">
      <div className="flex-1 flex flex-col px-5 pt-[calc(1.4rem+env(safe-area-inset-top))] pb-28 gap-5 max-w-md w-full mx-auto">
        <header className="rise rise-1">
          <p className="label mb-1">Goals</p>
          <h1 className="display-hero text-2xl">Set it. Break it down. No excuses.</h1>
        </header>

        {/* Primary, always-open action — plain manual add, no AI, costs
            zero tokens. This used to be the AI capture box; swapped per
            Jay's explicit ask ("task have to use groq? ... i should be
            able to add as many task freely") so the default, no-thought
            path never touches the model at all. The Assistant still
            exists for loose free-text capture, just moved into the
            accordion below instead of being the default. */}
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
              {myGoals.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.title}
                </option>
              ))}
            </select>
          </div>
          {myOpenTasks.length > 0 && (
            <select
              value={manualBlockedBy}
              onChange={(e) => setManualBlockedBy(e.target.value)}
              className="panel-strong rounded-xl px-4 py-3 outline-none focus:border-ink/30 transition text-ink text-[13px] w-full min-w-0"
            >
              <option value="">Not blocked by anything</option>
              {myOpenTasks.map((t) => (
                <option key={t.id} value={t.id}>
                  Blocked by: {t.title}
                </option>
              ))}
            </select>
          )}
          <button
            onClick={addManualTask}
            disabled={manualAdding || !manualTitle.trim()}
            className="btn-verdict rounded-xl py-3 font-extrabold disabled:opacity-50 active:scale-[0.98] transition-transform"
          >
            {manualAdding ? "Adding..." : "Add task"}
          </button>
        </section>

        {/* Accordion — goal creation and the AI Assistant both live behind
            one tap, one form visible at a time via the tab row, so a plain
            everyday "add a task" never has to load either. */}
        <section className="rise rise-2">
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

              {/* One goal form, two outcomes — a plain container ("Create
                  goal") or the same input handed to AI for a full daily-task
                  breakdown ("Break it down instead"). These used to be two
                  separate tabs asking the user to pre-decide which they
                  wanted before typing anything; now it's one form and the
                  choice is which button you tap at the end. */}
              {moreTab === "goal" && (
                <div className="panel rounded-2xl p-4 flex flex-col gap-3">
                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Goal title — e.g. Launch product v2 by Q4"
                    className="panel-strong rounded-xl px-4 py-3 outline-none focus:border-ink/30 transition placeholder:text-ink-faint text-ink text-sm"
                  />
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Any details worth knowing (optional)"
                    rows={2}
                    className="panel-strong rounded-xl px-4 py-3 outline-none focus:border-ink/30 transition placeholder:text-ink-faint text-ink text-sm"
                  />
                  <input
                    type="date"
                    value={targetDate}
                    onChange={(e) => setTargetDate(e.target.value)}
                    className="panel-strong rounded-xl px-4 py-3 outline-none focus:border-ink/30 transition text-ink text-sm"
                  />
                  <button
                    onClick={createGoal}
                    disabled={creatingGoal || breaking || !title.trim()}
                    className="btn-verdict rounded-xl py-3.5 font-extrabold disabled:opacity-50 active:scale-[0.98] transition-transform"
                  >
                    {creatingGoal ? "Creating..." : "Create goal"}
                  </button>
                  <button
                    onClick={breakDown}
                    disabled={breaking || creatingGoal || !title.trim()}
                    className="btn-ghost rounded-xl py-2.5 text-xs font-bold disabled:opacity-50 active:scale-[0.98] transition-transform"
                  >
                    {breaking ? "Breaking it down..." : "Or let AI break it into daily tasks →"}
                  </button>
                  {error && (
                    <div className="flex flex-col gap-2">
                      <p className="text-red text-sm font-semibold">{error}</p>
                      <button onClick={breakDown} className="btn-ghost rounded-xl py-2.5 text-sm font-bold">
                        Retry
                      </button>
                    </div>
                  )}
                  {lastCreatedCount !== null && (
                    <p className="text-verdict text-sm font-semibold">
                      Goal created — {lastCreatedCount} daily tasks added to your docket.
                    </p>
                  )}
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
                    placeholder="e.g. call the VPS guy tomorrow at 5pm about the migration"
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
                      <p className="text-red text-sm font-semibold">{parseError}</p>
                      <button
                        onClick={async () => {
                          if (!captureText.trim()) return;
                          setAddingDraft(true);
                          await fetch("/api/tasks", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ title: captureText.trim(), due_at: null, goal_id: null, visibility: visibilityWanted }),
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
                        {addingDraft ? "Adding..." : "Add to docket"}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </section>

        <section className="rise rise-5">
          <h2 className="text-[13px] font-bold text-ink-dim uppercase tracking-[0.08em] px-1 mb-1">Your goals</h2>
          {myGoals.length === 0 && (
            <div className="px-1 py-6 text-center">
              <p className="text-ink-dim text-sm font-medium">No goals yet. Set one above.</p>
            </div>
          )}
          <div className="flex flex-col">
            {myGoals.map((g) => (
              <GoalRow key={g.id} g={g} />
            ))}
          </div>
        </section>

        <section className="rise rise-6">
          <h2 className="text-[13px] font-bold text-ink-dim uppercase tracking-[0.08em] px-1 mb-1">
            {partner?.display_name ?? "Partner"}&apos;s goals
          </h2>
          {partnerGoals.length === 0 && (
            <div className="px-1 py-6 text-center">
              <p className="text-ink-dim text-sm font-medium">Nothing on record yet.</p>
            </div>
          )}
          <div className="flex flex-col">
            {partnerGoals.map((g) => (
              <GoalRow key={g.id} g={g} />
            ))}
          </div>
        </section>
      </div>
      <BottomNav />
    </div>
  );
}
