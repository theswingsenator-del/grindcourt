"use client";

// Personal Stakes — pulled completely out of the Team Ledger. Jay was
// explicit: personal stakes must never share a screen with Fines/Treasury
// again ("I'm even surprised why personal fines is in the same section
// with fines and treasury"). Self-imposed only — honor system, no partner
// approval, no AI Judge. RLS on personal_stakes guarantees this query can
// only ever return the caller's own rows regardless of any UI bug.

import { useMemo, useState } from "react";
import { useRealtimeQuery } from "@/lib/useRealtimeTable";
import { supabase } from "@/lib/supabase";
import { formatNaira } from "@/lib/fines";
import { Task, PersonalStake } from "@/lib/types";

interface PersonalStakesData {
  stakes: PersonalStake[];
  tasks: Task[];
}

async function fetchPersonalStakes(): Promise<PersonalStakesData> {
  const [{ data: stakes }, { data: tasks }] = await Promise.all([
    supabase.from("personal_stakes").select("*").order("created_at", { ascending: false }),
    supabase.from("tasks").select("*").eq("visibility", "personal"),
  ]);
  return { stakes: stakes ?? [], tasks: tasks ?? [] };
}

export default function PersonalStakesPage() {
  const { data, reload } = useRealtimeQuery(["personal_stakes", "tasks"], fetchPersonalStakes);
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  const tasksById = useMemo(() => {
    const map = new Map<string, Task>();
    for (const t of data?.tasks ?? []) map.set(t.id, t);
    return map;
  }, [data]);

  async function resolve(id: string, status: "paid" | "waived") {
    setResolvingId(id);
    await fetch("/api/personal-stakes/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status }),
    });
    setResolvingId(null);
    reload();
  }

  if (!data) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 py-12">
        <div className="w-9 h-9 rounded-full border-2 border-ink-faint/25 border-t-ink animate-spin" />
      </div>
    );
  }

  const active = data.stakes.filter((s) => s.status === "active");
  const resolved = data.stakes.filter((s) => s.status !== "active");
  const totalActive = active.reduce((sum, s) => sum + s.amount, 0);

  return (
    <div className="flex-1 flex flex-col px-5 pt-2 pb-28 gap-5 max-w-md w-full mx-auto">
      <header className="rise rise-1">
        <p className="label mb-1">Stakes</p>
        <h1 className="display-hero text-2xl">Only you keep score here.</h1>
      </header>

      {/* Rule #1's counterpart for a screen with no natural ring stat — a
          money total has no meaningful 0–100% fill (unlike a day-count or
          streak), so per the same convention Team's dashboard uses for its
          fines count, this drops to a quiet inline stat line instead of
          forcing a ring where one doesn't belong. */}
      <p className="rise rise-2 stat-inline">
        <b>{active.length}</b> active<span className="sep">·</span>
        <b>{formatNaira(totalActive)}</b> on the table
      </p>

      <p className="rise rise-2 text-[11.5px] text-ink-faint leading-snug px-1">
        🔒 Self-imposed only — honor system. No partner approval, no AI Judge, nobody to appeal to but you.
      </p>

      <section className="rise rise-3">
        <h2 className="text-[13px] font-bold text-ink-dim uppercase tracking-[0.08em] px-1 mb-1">Active</h2>
        {active.length === 0 && (
          <div className="px-1 py-6 text-center">
            <p className="text-ink-dim text-sm font-medium">No active personal stakes.</p>
          </div>
        )}
        <div className="flex flex-col">
          {active.map((s) => (
            <div key={s.id} className="list-row items-start">
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-bold text-ink-dim uppercase tracking-wide">
                  {tasksById.get(s.task_id)?.title ?? "Personal task"}
                </p>
                <p className="money text-xl font-extrabold text-ink mt-1">{formatNaira(s.amount)}</p>
              </div>
              <div className="shrink-0 flex flex-col gap-2 w-24">
                <button
                  onClick={() => resolve(s.id, "paid")}
                  disabled={resolvingId === s.id}
                  className="btn-verdict rounded-lg py-2 text-[11px] font-extrabold disabled:opacity-50"
                >
                  {resolvingId === s.id ? "..." : "Mark paid"}
                </button>
                <button
                  onClick={() => resolve(s.id, "waived")}
                  disabled={resolvingId === s.id}
                  className="btn-ghost rounded-lg py-2 text-[11px] font-bold disabled:opacity-50"
                >
                  Waive
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      {resolved.length > 0 && (
        <section className="rise rise-4">
          <h2 className="text-[13px] font-bold text-ink-dim uppercase tracking-[0.08em] px-1 mb-1">Closed</h2>
          <div className="flex flex-col">
            {resolved.map((s) => (
              <div key={s.id} className="list-row">
                <div className="flex-1 min-w-0">
                  <p className="text-[12.5px] text-ink-dim font-semibold truncate">{tasksById.get(s.task_id)?.title ?? "Personal task"}</p>
                  <p className="label mt-0.5">{s.status === "paid" ? "PAID" : "WAIVED"}</p>
                </div>
                <p className="money text-sm font-bold text-ink-faint shrink-0">{formatNaira(s.amount)}</p>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
