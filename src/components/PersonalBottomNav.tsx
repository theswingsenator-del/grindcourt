"use client";

// Personal mode's own nav — deliberately not a clone of BottomNav with
// swapped labels. Team's nav is Docket/Goals/Check-In/Ledger/Inbox because
// partner accountability needs a check-in surface and a fines+treasury
// ledger. A private solo space doesn't: there's no partner to check in
// with (missed_log only ever fires on visibility='partner' activity, see
// lib/violations.ts) and no fines/treasury to speak of, only self-imposed
// stakes — which is exactly why Stakes gets pulled out into its own tab
// here instead of living inside a combined ledger. Four tabs: Docket,
// Goals, Stakes, Activity — Activity is a private log of your own
// completed tasks and resolved stakes, NOT a clone of Team's push
// Inbox — there's no partner-facing notification stream in Personal
// mode (personal tasks never notify() the other partner and never
// fine, see api/tasks/route.ts and lib/violations.ts).
//
// Rendered inside the .personal-scope tree (see src/app/personal/layout.tsx)
// so every shared token this reads (--ink, --line, --ground via the
// segpill/panel mechanism) already resolves to the cooler Personal palette
// — no separate personal color set needed here.
//
// Flat nav — same structural language as Team's BottomNav (plain icons,
// evenly spaced, no capsule, no sliding indicator; active = accent-colored
// icon + 4px dot beneath), recolored automatically via --accent inside
// .personal-scope.

import Link from "next/link";
import { usePathname } from "next/navigation";

function IconDocket() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" strokeWidth="1.8" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 6.5h14M5 12h14M5 17.5h9" />
    </svg>
  );
}

function IconGoals() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" strokeWidth="1.8" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="8.25" />
      <circle cx="12" cy="12" r="3.75" />
    </svg>
  );
}

function IconStakes() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" strokeWidth="1.8" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5v9M9.25 9.75c0-1.25 1.1-2 2.75-2s2.75.7 2.75 1.8c0 2.4-5.5 1-5.5 3.4 0 1.1 1.1 1.8 2.75 1.8s2.75-.75 2.75-2" />
    </svg>
  );
}

function IconActivity() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" strokeWidth="1.8" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5.5l3.5 2" />
    </svg>
  );
}

const TABS = [
  { href: "/personal", label: "Docket", Icon: IconDocket },
  { href: "/personal/goals", label: "Goals", Icon: IconGoals },
  { href: "/personal/stakes", label: "Stakes", Icon: IconStakes },
  { href: "/personal/activity", label: "Activity", Icon: IconActivity },
];

export default function PersonalBottomNav() {
  const pathname = usePathname();
  const activeIndex = Math.max(0, TABS.findIndex((t) => t.href === pathname));

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 pb-[calc(6px+env(safe-area-inset-bottom))] pointer-events-none">
      <div
        className="pointer-events-auto max-w-md mx-auto flat-nav pt-2"
        style={{ background: "linear-gradient(to top, var(--ground) 55%, transparent)" }}
      >
        {TABS.map(({ href, label, Icon }, i) => {
          const active = i === activeIndex;
          return (
            <Link
              key={href}
              href={href}
              aria-label={label}
              aria-current={active ? "page" : undefined}
              className={`flat-nav-item ${active ? "active" : ""}`}
            >
              <Icon />
              <span className="flat-nav-dot" />
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
