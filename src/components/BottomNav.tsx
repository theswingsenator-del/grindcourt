"use client";

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

function IconCheckin() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" strokeWidth="1.8" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="4.5" width="16" height="15.5" rx="2.5" />
      <path d="M4 9.5h16" />
      <path d="M8.5 13.5l2.2 2.2L15.5 11.5" />
    </svg>
  );
}

function IconLedger() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" strokeWidth="1.8" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4.5" y="3.5" width="15" height="17" rx="1.8" />
      <path d="M8 8h8M8 12h8M8 16h5" />
    </svg>
  );
}

function IconInbox() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" strokeWidth="1.8" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="5.5" width="16" height="13" rx="2" />
      <path d="M4 7l8 6 8-6" />
    </svg>
  );
}

const TABS = [
  { href: "/", label: "Docket", Icon: IconDocket },
  { href: "/goals", label: "Goals", Icon: IconGoals },
  { href: "/checkin", label: "Check-In", Icon: IconCheckin },
  { href: "/ledger", label: "Ledger", Icon: IconLedger },
  { href: "/notifications", label: "Inbox", Icon: IconInbox },
];

// Flat nav — plain icons, evenly spaced, no capsule/pill background and no
// sliding indicator. Active state is purely a color change on the icon plus
// a 4px dot centered underneath it (see .flat-nav / .flat-nav-item /
// .flat-nav-dot in globals.css). This replaces the floating pill bar with
// the sliding accent capsule from the previous build.
export default function BottomNav() {
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
