"use client";

// Renders the full-screen wipe driven by PersonalModeContext's
// goPersonal()/goTeam(). Mounted once in the root layout (outside the
// Team/Personal route split) so it works no matter which globe the switch
// starts from. Purely presentational — all timing/state lives in the
// context so this component can't get out of sync with the router.push()
// it's supposed to be covering.

import { usePersonalMode } from "@/lib/PersonalModeContext";

export default function ModeTransitionOverlay() {
  const { transition } = usePersonalMode();
  if (!transition) return null;

  const enteringPersonal = transition.target === "personal";
  const bg = enteringPersonal ? "#0a0d14" : "#0a0b0c";
  const labelColor = enteringPersonal ? "#8e97b8" : "#9296a0";
  const label = enteringPersonal ? "Entering Personal" : "Back to Team";

  return (
    <div className={`mode-wipe${transition.leaving ? " leaving" : ""}`} aria-hidden="true">
      <div className="panel-l" style={{ background: bg }} />
      <div className="panel-r" style={{ background: bg }} />
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="label" style={{ color: labelColor }}>
          {label}
        </span>
      </div>
    </div>
  );
}
