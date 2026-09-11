"use client";

import { useState } from "react";
import { useSession } from "@/lib/useSession";
import { useRealtimeQuery } from "@/lib/useRealtimeTable";
import { supabase } from "@/lib/supabase";
import { DailyLog } from "@/lib/types";
import BottomNav from "@/components/BottomNav";

async function fetchTodayLog(userId: string | undefined): Promise<DailyLog | null> {
  if (!userId) return null;
  const today = new Date().toISOString().slice(0, 10);
  const { data } = await supabase
    .from("daily_logs")
    .select("*")
    .eq("owner_id", userId)
    .eq("log_date", today)
    .maybeSingle();
  return data ?? null;
}

// Hero ring — the ONE dominant stat on this screen is "how much of today's
// check-in is done" (0/1/2 slots). Same ring primitive as the dashboard's
// day-count hero (approved-composition rule #1), repurposed for a 2-slot
// count instead of a 7-day cycle.
function HeroRing({ value, label, pct }: { value: string | number; label: string; pct: number }) {
  const size = 132;
  const r = 57;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(1, pct));
  const dash = c * clamped;
  return (
    <div className="ring-hero">
      <div className="relative" style={{ width: size, height: size }}>
        <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-raised)" strokeWidth="8" />
          {clamped > 0 && (
            <circle
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke="var(--accent)"
              strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray={`${dash} ${c}`}
            />
          )}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="stat-num text-[36px] leading-none">{value}</span>
          <span className="label mt-1.5">{label}</span>
        </div>
      </div>
    </div>
  );
}

export default function CheckinPage() {
  const { appUser } = useSession();
  const { data: log, reload } = useRealtimeQuery(["daily_logs"], () => fetchTodayLog(appUser?.id), [appUser?.id]);
  const [morningText, setMorningText] = useState("");
  const [nightText, setNightText] = useState("");
  const [savingMorning, setSavingMorning] = useState(false);
  const [savingNight, setSavingNight] = useState(false);

  async function submitMorning() {
    setSavingMorning(true);
    await fetch("/api/daily-log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slot: "morning", text: morningText }),
    });
    setSavingMorning(false);
    setMorningText("");
    reload();
  }

  async function submitNight() {
    setSavingNight(true);
    await fetch("/api/daily-log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slot: "night", text: nightText }),
    });
    setSavingNight(false);
    setNightText("");
    reload();
  }

  const loggedCount = (log?.morning_commit_done ? 1 : 0) + (log?.night_report_done ? 1 : 0);

  return (
    <div className="flex-1 flex flex-col">
      <div className="flex-1 flex flex-col px-5 pt-[calc(1.4rem+env(safe-area-inset-top))] pb-28 gap-6 max-w-md w-full mx-auto">
        <header className="rise rise-1">
          <p className="label mb-1">Daily check-in</p>
          <h1 className="display-hero text-2xl">Report in — if there was anything to report.</h1>
        </header>

        {/* Rule #1 — one dominant hero ring (slots logged today), everything
            else drops to a single quiet inline line + the two boxless
            report sections below. */}
        <div className="rise rise-2 flex flex-col items-center gap-3">
          <HeroRing value={`${loggedCount}/2`} label="Logged today" pct={loggedCount / 2} />
          <p className="stat-inline text-center max-w-70">
            Only counts on days with real skin in the game — a task due today, or one you completed today.
          </p>
        </div>

        {/* Boxless, single-focus report entries — no .panel wrapper, content
            separated by spacing like the rest of the system. Each behaves
            like a tiny disclosure: quiet checkmark line once logged, open
            input while pending. */}
        <section className="rise rise-2 flex flex-col gap-3">
          <div className="flex items-center justify-between px-0.5">
            <p className="label">Morning commit</p>
            {log?.morning_commit_done && <span className="text-verdict text-xs font-bold">✓ LOGGED</span>}
          </div>
          {log?.morning_commit_done ? (
            <p className="text-sm text-ink-dim italic px-0.5">&ldquo;{log.morning_commit_text || "(no note)"}&rdquo;</p>
          ) : (
            <div className="flex flex-col gap-3">
              <textarea
                value={morningText}
                onChange={(e) => setMorningText(e.target.value)}
                placeholder="What are you committing to today?"
                rows={3}
                className="panel-strong rounded-xl px-4 py-3 outline-none focus:border-ink/30 transition placeholder:text-ink-faint text-ink text-sm"
              />
              <button
                onClick={submitMorning}
                disabled={savingMorning}
                className="btn-verdict rounded-xl py-3 font-extrabold disabled:opacity-50 active:scale-[0.98] transition-transform"
              >
                {savingMorning ? "Logging..." : "Commit"}
              </button>
            </div>
          )}
        </section>

        <section className="rise rise-3 flex flex-col gap-3">
          <div className="flex items-center justify-between px-0.5">
            <p className="label">Night report</p>
            {log?.night_report_done && <span className="text-verdict text-xs font-bold">✓ LOGGED</span>}
          </div>
          {log?.night_report_done ? (
            <p className="text-sm text-ink-dim italic px-0.5">&ldquo;{log.night_report_text || "(no note)"}&rdquo;</p>
          ) : (
            <div className="flex flex-col gap-3">
              <textarea
                value={nightText}
                onChange={(e) => setNightText(e.target.value)}
                placeholder="What did you actually get done?"
                rows={3}
                className="panel-strong rounded-xl px-4 py-3 outline-none focus:border-ink/30 transition placeholder:text-ink-faint text-ink text-sm"
              />
              <button
                onClick={submitNight}
                disabled={savingNight}
                className="btn-verdict rounded-xl py-3 font-extrabold disabled:opacity-50 active:scale-[0.98] transition-transform"
              >
                {savingNight ? "Logging..." : "Report"}
              </button>
            </div>
          )}
        </section>

        <p className="text-ink-faint text-[11.5px] leading-snug px-0.5 -mt-1">
          Nothing on the docket today? Then there&apos;s nothing to check in about — this can&apos;t fine you for a day
          you had genuinely nothing scheduled, no matter what you do or don&apos;t log above.
        </p>
      </div>
      <BottomNav />
    </div>
  );
}
