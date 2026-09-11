"use client";

// The Assistant — rebuilt with an actual identity instead of a plain
// 4-step form (Jay: "vague, no creativity around that"). Distinct from
// both the Judge (/talk — stern, direct, enforcement-flavored) and from
// generic wizard UX: one generous "tell me" screen instead of a paginated
// intake/why split, a personality-driven "thinking" state that cycles real
// phrases instead of a static spinner, and warmer copy throughout.
//
// Shared between Team (/assistant) and Personal (/personal/assistant) —
// same component, different `variant`. Personal's page already renders
// inside .personal-scope (src/app/personal/layout.tsx) so the cooler
// palette comes for free from the shared CSS tokens; this component only
// branches on copy, the optional stake step, and where "done" sends you.
//
// Mechanism is untouched: still parseNaturalLanguageTask via
// /api/tasks/parse, still retry-once-then-safe-fallback (that logic lives
// server-side in lib/planner.ts, not touched here) — this is a
// presentation-layer rebuild only.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/lib/useSession";
import { supabase } from "@/lib/supabase";
import { Goal } from "@/lib/types";

type Step = "intake" | "confirm" | "stake" | "done";

interface Draft {
  title: string;
  due_at: string | null;
  goal_id: string | null;
  goal_title: string | null;
}

const THINKING_LINES = [
  "Reading between the lines...",
  "Finding the actual deadline...",
  "Shaping it into a task...",
  "Almost there...",
];

const TEAM_COPY = {
  eyebrow: "The Assistant",
  headline: "Tell me what's on your mind.",
  sub: "One sentence is enough — I'll turn it into a real task on your docket.",
  placeholder: "e.g. call the VPS guy tomorrow at 5pm about the migration",
  confirmHeadline: "Here's what I've got.",
  confirmSub: "Adjust anything before it goes on the record.",
  addLabel: "Add to docket",
  doneHeadline: "It's on the docket.",
  doneSub: "Go get it done — I'll be here when you need me again.",
  backLabel: "Back to docket",
};

const PERSONAL_COPY = {
  eyebrow: "The Assistant",
  headline: "What do you want to get done — just for you?",
  sub: "Say it however it comes out. This stays private, only you'll ever see it.",
  placeholder: "e.g. read 30 pages tonight before bed",
  confirmHeadline: "Does this look right?",
  confirmSub: "It's private either way — tweak it if you want.",
  addLabel: "Add to private docket",
  doneHeadline: "Quietly on the docket.",
  doneSub: "No one else knows it's there but you.",
  backLabel: "Back to your docket",
};

export default function AssistantExperience({
  variant,
  afterCreateHref,
}: {
  variant: "team" | "personal";
  afterCreateHref: string;
}) {
  const router = useRouter();
  const { appUser, loading: sessionLoading } = useSession();
  const copy = variant === "personal" ? PERSONAL_COPY : TEAM_COPY;
  const visibility = variant === "personal" ? "personal" : "partner";

  const [step, setStep] = useState<Step>("intake");
  const [goals, setGoals] = useState<Goal[]>([]);

  const [text, setText] = useState("");
  const [showWhy, setShowWhy] = useState(false);
  const [why, setWhy] = useState("");
  const [parsing, setParsing] = useState(false);
  const [thinkingLine, setThinkingLine] = useState(THINKING_LINES[0]);
  const [parseError, setParseError] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);

  const [creating, setCreating] = useState(false);
  const [createdTaskId, setCreatedTaskId] = useState<string | null>(null);

  const [stakeAmount, setStakeAmount] = useState("");
  const [stakeSaving, setStakeSaving] = useState(false);
  const [stakeSaved, setStakeSaved] = useState(false);

  const thinkingTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!appUser) return;
    supabase
      .from("goals")
      .select("*")
      .eq("owner_id", appUser.id)
      .then(({ data }) => setGoals(data ?? []));
  }, [appUser]);

  useEffect(() => {
    if (!parsing) {
      if (thinkingTimer.current) clearInterval(thinkingTimer.current);
      return;
    }
    let i = 0;
    setThinkingLine(THINKING_LINES[0]);
    thinkingTimer.current = setInterval(() => {
      i = (i + 1) % THINKING_LINES.length;
      setThinkingLine(THINKING_LINES[i]);
    }, 850);
    return () => {
      if (thinkingTimer.current) clearInterval(thinkingTimer.current);
    };
  }, [parsing]);

  async function parse() {
    if (!text.trim()) return;
    setParsing(true);
    setParseError("");
    const combinedText = why.trim() ? `${text.trim()} — ${why.trim()}` : text.trim();
    const res = await fetch("/api/tasks/parse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: combinedText }),
    });
    const json = await res.json();
    setParsing(false);
    if (!res.ok) {
      setParseError(json.error ?? "Couldn't structure that — try rephrasing.");
      return;
    }
    setDraft(json.draft);
    setStep("confirm");
  }

  // The AI parse can fail on a perfectly normal sentence (real, if
  // occasional, model flakiness — see lib/planner.ts) and there was no way
  // past that dead end: rephrasing the exact same text just risks the same
  // coin flip again. This skips AI entirely and adds the raw text as the
  // title, verbatim, no due date, no goal — always available the moment a
  // parse fails, so "add a task" can never be fully blocked by the AI.
  async function addAsTyped() {
    if (!text.trim()) return;
    setCreating(true);
    const res = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: text.trim(), due_at: null, goal_id: null, description: why.trim() || null, visibility }),
    });
    const json = await res.json();
    setCreating(false);
    if (!res.ok || !json.task) {
      setParseError(json.error ?? "Couldn't add that — try again.");
      return;
    }
    setCreatedTaskId(json.task.id);
    setStep(variant === "personal" ? "stake" : "done");
  }

  async function confirmDraft() {
    if (!draft) return;
    setCreating(true);
    const description = why.trim() || null;
    const res = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: draft.title, due_at: draft.due_at, goal_id: draft.goal_id, description, visibility }),
    });
    const json = await res.json();
    setCreating(false);
    if (!res.ok || !json.task) {
      setParseError(json.error ?? "Couldn't add that task — try again.");
      return;
    }
    setCreatedTaskId(json.task.id);
    setStep(variant === "personal" ? "stake" : "done");
  }

  async function saveStake() {
    if (!createdTaskId) return;
    const amount = Number(stakeAmount);
    if (!amount || amount <= 0) {
      setStep("done");
      return;
    }
    setStakeSaving(true);
    await fetch("/api/personal-stakes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task_id: createdTaskId, amount }),
    });
    setStakeSaving(false);
    setStakeSaved(true);
    setStep("done");
  }

  function reset() {
    setStep("intake");
    setText("");
    setWhy("");
    setShowWhy(false);
    setDraft(null);
    setParseError("");
    setCreatedTaskId(null);
    setStakeAmount("");
    setStakeSaved(false);
  }

  if (sessionLoading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4">
        <div className="w-9 h-9 rounded-full border-2 border-ink-faint/25 border-t-ink animate-spin" />
      </div>
    );
  }

  const topPadding = variant === "team" ? "pt-[calc(1.4rem+env(safe-area-inset-top))]" : "pt-2";

  return (
    <div className={`flex-1 flex flex-col px-5 ${topPadding} pb-10 gap-6 max-w-md w-full mx-auto`}>
      <header className="rise rise-1 flex items-center justify-between">
        <button onClick={() => router.back()} className="label">&larr; Back</button>
        <div className="ai-line">
          <div className={`ai-orb ${parsing ? "pulse-alert" : ""}`} />
          <span>{copy.eyebrow}</span>
        </div>
      </header>

      {/* Every step below drops the old single giant panel-strong card that
          wrapped headline + inputs + button as one box. Headline/copy now
          sit directly on the bare page background (matching the goals/
          checkin header convention elsewhere in the app); only the actual
          editable surfaces (textarea, the confirm-review fields, the stake
          input) get a single level of panel-strong surfacing. Since only
          one step is ever mounted at a time this was never "3 forms open at
          once", but it *was* nested double-boxing (panel-strong > panel)
          for no real grouping value — this removes that nesting. */}
      {step === "intake" && (
        <section className="rise rise-2 flex flex-col gap-4">
          <div>
            <h1 className="display-hero text-2xl leading-tight">{copy.headline}</h1>
            <p className="text-[12.5px] text-ink-dim mt-2 leading-snug">{copy.sub}</p>
          </div>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={copy.placeholder}
            rows={3}
            autoFocus
            className="panel-strong rounded-xl px-4 py-3 outline-none focus:border-ink/30 transition placeholder:text-ink-faint text-ink text-sm"
          />

          {!showWhy && (
            <button onClick={() => setShowWhy(true)} className="label text-left w-fit">
              + add why it matters (optional)
            </button>
          )}
          {showWhy && (
            <textarea
              value={why}
              onChange={(e) => setWhy(e.target.value)}
              placeholder="Any context worth remembering..."
              rows={2}
              className="panel-strong rounded-xl px-4 py-3 outline-none focus:border-ink/30 transition placeholder:text-ink-faint text-ink text-sm"
            />
          )}

          {parsing && (
            <div className="ai-line px-0.5">
              <div className="ai-orb pulse-alert" style={{ width: 14, height: 14 }} />
              <span>{thinkingLine}</span>
            </div>
          )}
          {parseError && (
            <div className="flex flex-col gap-2">
              <p className="text-sm font-semibold" style={{ color: "var(--red)" }}>{parseError}</p>
              <button
                onClick={addAsTyped}
                disabled={creating || !text.trim()}
                className="btn-ghost rounded-xl py-3 text-sm font-bold disabled:opacity-50 active:scale-[0.98] transition-transform"
              >
                {creating ? "Adding..." : "Skip that — just add it as typed"}
              </button>
            </div>
          )}

          <button
            onClick={parse}
            disabled={parsing || !text.trim()}
            className="btn-verdict rounded-xl py-3.5 font-extrabold disabled:opacity-50 active:scale-[0.98] transition-transform"
          >
            {parsing ? "Working on it..." : "Structure it for me"}
          </button>
        </section>
      )}

      {step === "confirm" && draft && (
        <section className="rise rise-2 flex flex-col gap-4">
          <div>
            <p className="label mb-2">Review before it&apos;s added</p>
            <h1 className="display-hero text-xl leading-snug">{copy.confirmHeadline}</h1>
            <p className="text-[12px] text-ink-dim mt-1.5 leading-snug">{copy.confirmSub}</p>
          </div>
          <div className="panel-strong rounded-xl p-4 flex flex-col gap-3">
            <div>
              <p className="label mb-1.5">Title</p>
              <input
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                className="bg-transparent outline-none text-ink font-semibold text-[15px] pb-2 w-full min-w-0"
              />
            </div>
            <div>
              <p className="label mb-1.5">Due</p>
              <input
                type="datetime-local"
                value={draft.due_at ? draft.due_at.slice(0, 16) : ""}
                onChange={(e) => setDraft({ ...draft, due_at: e.target.value || null })}
                className="bg-transparent outline-none text-ink-dim text-sm w-full min-w-0"
              />
            </div>
            {goals.length > 0 && (
              <div>
                <p className="label mb-1.5">Goal</p>
                <select
                  value={draft.goal_id ?? ""}
                  onChange={(e) => {
                    const goalId = e.target.value || null;
                    const goal = goals.find((g) => g.id === goalId);
                    setDraft({ ...draft, goal_id: goalId, goal_title: goal?.title ?? null });
                  }}
                  className="bg-transparent outline-none text-ink-dim text-sm w-full min-w-0"
                >
                  <option value="">No goal</option>
                  {goals.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.title}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
          {parseError && <p className="text-sm font-semibold" style={{ color: "var(--red)" }}>{parseError}</p>}
          <div className="flex gap-2">
            <button onClick={() => setStep("intake")} className="btn-ghost rounded-xl px-4 py-3 text-sm font-bold shrink-0">
              Start over
            </button>
            <button
              onClick={confirmDraft}
              disabled={creating || !draft.title.trim()}
              className="btn-verdict flex-1 rounded-xl py-3 font-extrabold disabled:opacity-50 active:scale-[0.98] transition-transform"
            >
              {creating ? "Adding..." : copy.addLabel}
            </button>
          </div>
        </section>
      )}

      {step === "stake" && (
        <section className="rise rise-2 flex flex-col gap-4">
          <div className="ai-line">
            <div className="ai-orb" style={{ width: 16, height: 16 }} />
            <span>Optional</span>
          </div>
          <div>
            <h1 className="display-hero text-xl leading-snug">Put something behind it?</h1>
            <p className="text-[12px] text-ink-dim mt-1.5 leading-snug">
              Since it&apos;s just you, you set the amount — self-imposed, honor system, no one to appeal to. Skip if you don&apos;t want one.
            </p>
          </div>
          <input
            type="number"
            value={stakeAmount}
            onChange={(e) => setStakeAmount(e.target.value)}
            placeholder="Amount (₦)"
            className="panel-strong rounded-xl px-4 py-3 outline-none focus:border-ink/30 transition placeholder:text-ink-faint text-ink text-sm"
          />
          <div className="flex gap-2">
            <button onClick={() => setStep("done")} className="btn-ghost rounded-xl px-4 py-3 text-sm font-bold shrink-0">
              Skip
            </button>
            <button
              onClick={saveStake}
              disabled={stakeSaving}
              className="btn-verdict flex-1 rounded-xl py-3 font-extrabold disabled:opacity-50 active:scale-[0.98] transition-transform"
            >
              {stakeSaving ? "Setting it..." : "Set stake"}
            </button>
          </div>
        </section>
      )}

      {step === "done" && (
        <section className="rise rise-2 flex flex-col items-center gap-4 text-center py-10">
          <div className="ai-orb" style={{ width: 56, height: 56 }} />
          <div>
            <h1 className="display-hero text-2xl leading-snug">{copy.doneHeadline}</h1>
            <p className="text-[13px] text-ink-dim mt-2 leading-snug max-w-72 mx-auto">
              {variant === "personal" && stakeSaved ? "Task added, stake set. That's between you and you." : copy.doneSub}
            </p>
          </div>
          <div className="flex gap-2 w-full mt-2">
            <button onClick={reset} className="btn-ghost flex-1 rounded-xl py-3 text-sm font-bold">
              Add another
            </button>
            <button onClick={() => router.push(afterCreateHref)} className="btn-verdict flex-1 rounded-xl py-3 font-extrabold">
              {copy.backLabel}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
