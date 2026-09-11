"use client";

// Personal Activity — a private record of what you've actually done in
// this space: completed private tasks and resolved stakes, newest first.
// Deliberately not a clone of Team's Inbox: personal tasks never notify()
// the other partner (see api/tasks/route.ts) and never generate a fine
// (detectOverdueTasks skips visibility='personal' tasks, lib/violations.ts),
// so there is no push-notification stream to show here — this reads
// straight off tasks/personal_stakes instead, which is honest about what
// actually happens in Personal mode.

import { useMemo } from "react";
import { useSession } from "@/lib/useSession";
import { useRealtimeQuery } from "@/lib/useRealtimeTable";
import { supabase } from "@/lib/supabase";
import { formatNaira } from "@/lib/fines";
import { Task, PersonalStake } from "@/lib/types";

interface ActivityData {
  tasks: Task[];
  stakes: PersonalStake[];
}

async function fetchActivity(userId: string | undefined): Promise<ActivityData> {
  if (!userId) return { tasks: [], stakes: [] };
  const [{ data: tasks }, { data: stakes }] = await Promise.all([
    supabase.from("tasks").select("*").eq("owner_id", userId).eq("visibility", "personal").eq("status", "done").order("completed_at", { ascending: false }).limit(30),
    supabase.from("personal_stakes").select("*").eq("owner_id", userId).neq("status", "active").order("created_at", { ascending: false }).limit(15),
  ]);
  return { tasks: tasks ?? [], stakes: stakes ?? [] };
}

type Item = { id: string; at: string; kind: "task" | "stake"; text: string; amount?: number };

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function PersonalActivityPage() {
  const { appUser } = useSession();
  const { data } = useRealtimeQuery(["tasks", "personal_stakes"], () => fetchActivity(appUser?.id), [appUser?.id]);

  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];
    for (const t of data?.tasks ?? []) {
      if (!t.completed_at) continue;
      out.push({ id: `t-${t.id}`, at: t.completed_at, kind: "task", text: `Completed "${t.title}"` });
    }
    for (const s of data?.stakes ?? []) {
      out.push({
        id: `s-${s.id}`,
        at: s.paid_at ?? s.created_at,
        kind: "stake",
        text: s.status === "paid" ? "Stake paid" : "Stake waived",
        amount: s.amount,
      });
    }
    return out.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  }, [data]);

  return (
    <div className="flex-1 flex flex-col px-5 pt-2 pb-28 gap-5 max-w-md w-full mx-auto">
      <header className="rise rise-1">
        <p className="label mb-1">Activity</p>
        <h1 className="display-hero text-2xl">A record only you keep.</h1>
      </header>

      <section className="rise rise-2">
        {!data && (
          <div className="flex justify-center py-10">
            <div className="w-8 h-8 rounded-full border-2 border-ink-faint/25 border-t-ink animate-spin" />
          </div>
        )}
        {data && items.length === 0 && (
          <div className="px-1 py-8 text-center">
            <p className="text-ink-dim text-sm font-medium">Nothing logged here yet — finish a private task to start the record.</p>
          </div>
        )}
        <div className="flex flex-col">
          {items.map((item) => (
            <div key={item.id} className="list-row">
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-semibold text-ink truncate">{item.text}</p>
                <p className="text-[10.5px] text-ink-faint mt-0.5">{timeAgo(item.at)}</p>
              </div>
              {item.amount != null && (
                <p className="money text-sm font-bold text-ink-faint shrink-0">{formatNaira(item.amount)}</p>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
