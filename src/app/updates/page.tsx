"use client";

import Link from "next/link";
import { useRealtimeQuery } from "@/lib/useRealtimeTable";
import { supabase } from "@/lib/supabase";
import { FoundersUpdate } from "@/lib/types";
import BottomNav from "@/components/BottomNav";

async function fetchUpdates(): Promise<FoundersUpdate[]> {
  const { data } = await supabase.from("founders_updates").select("*").order("week_start", { ascending: false });
  return data ?? [];
}

function weekRangeLabel(weekStart: string): string {
  const start = new Date(weekStart);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  const fmt = (d: Date) => d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return `${fmt(start)} – ${fmt(end)}`;
}

export default function UpdatesPage() {
  const { data: updates } = useRealtimeQuery(["founders_updates"], fetchUpdates);

  return (
    <div className="flex-1 flex flex-col">
      <div className="flex-1 flex flex-col px-5 pt-[calc(1.4rem+env(safe-area-inset-top))] pb-28 gap-5 max-w-md w-full mx-auto">
        <header className="rise rise-1 flex items-center justify-between gap-3">
          <div>
            <p className="label mb-1">Founders&apos; Updates</p>
            <h1 className="display text-2xl font-bold">The weekly recap.</h1>
          </div>
          <Link href="/notifications" className="btn-ghost rounded-lg px-3 py-2 text-[11px] font-bold shrink-0">
            Inbox
          </Link>
        </header>

        <section className="rise rise-2">
          {(!updates || updates.length === 0) && (
            <div className="px-1 py-8 text-center">
              <p className="text-ink-dim text-sm font-medium">No updates yet — the first lands after a week of activity.</p>
            </div>
          )}
          <div className="flex flex-col">
            {updates?.map((u) => (
              <div key={u.id} className="list-row items-start">
                <div className="flex-1 min-w-0">
                  <div className="ai-line mb-1.5">
                    <div className="ai-orb" />
                    <span>The Narrator</span>
                  </div>
                  <div className="text-[13px] text-ink leading-relaxed whitespace-pre-line">
                    {u.body}
                  </div>
                </div>
                <span className="label shrink-0 text-right">{weekRangeLabel(u.week_start)}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
      <BottomNav />
    </div>
  );
}
