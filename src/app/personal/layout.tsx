"use client";

// Layout for the entire Personal globe (/personal, /personal/goals,
// /personal/stakes, /personal/inbox, /personal/assistant). Everything
// under this layout renders inside .personal-scope, which re-layers the
// shared design tokens onto the cooler "Drift" palette (see globals.css) —
// so every page underneath gets the different register for free just by
// living in this route tree, without each page having to know its own
// colors. This is also the one persistent "you're somewhere else now"
// affordance: a slim top strip with its own wordmark and the only way
// back to Team, instead of Team's nav still being visible with a mode
// pill bolted on.

import { usePersonalMode } from "@/lib/PersonalModeContext";
import PersonalBottomNav from "@/components/PersonalBottomNav";

export default function PersonalLayout({ children }: { children: React.ReactNode }) {
  const { goTeam } = usePersonalMode();

  return (
    <div className="personal-scope flex-1 flex flex-col">
      {/* relative z-10 lifts this whole content stack above the ambient
          ::before wash (see globals.css) — deliberately scoped here rather
          than a blanket rule on every .personal-scope child, since
          PersonalBottomNav below relies on its own `fixed` utility and a
          blanket position/z-index override would have fought it. */}
      <div className="relative z-10 flex-1 flex flex-col">
        <div className="flex items-center justify-between px-5 pt-[calc(0.85rem+env(safe-area-inset-top))] pb-2 max-w-md w-full mx-auto">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--accent)" }} />
            <p className="label" style={{ color: "var(--ink-faint)" }}>
              Personal
            </p>
          </div>
          <button
            onClick={goTeam}
            className="-m-1 flex items-center gap-1.5 rounded-full px-4 py-2.5 text-[11px] font-bold border transition-transform active:scale-95"
            style={{ borderColor: "var(--line)", color: "var(--ink-dim)" }}
          >
            Team <span aria-hidden="true">&rarr;</span>
          </button>
        </div>
        {children}
      </div>
      <PersonalBottomNav />
    </div>
  );
}
