"use client";

// Team / Personal — no longer a client-state toggle over a shared DOM tree.
// Personal mode is now a genuinely separate route tree (everything under
// /personal, its own layout in src/app/personal/layout.tsx, its own nav in
// src/components/PersonalBottomNav.tsx) so "mode" is simply derived from
// the current pathname — there's nothing to persist or hydrate, the URL
// already is the source of truth and survives reload/deep-link for free.
//
// What THIS file still owns: the cross-globe transition. Switching between
// Team and Personal needs to read as leaving one place and arriving at
// another (Jay: "let it feel like you switching to another globe of the
// app not a section"), not an instant re-render. goPersonal()/goTeam()
// cover the screen with a two-panel wipe (see .mode-wipe in globals.css),
// swap the route underneath the cover, then reveal — src/components/
// ModeTransitionOverlay.tsx is the thing that actually renders it, mounted
// once in the root layout so it works from any page in either globe.
//
// The real privacy boundary remains RLS on tasks/personal_stakes (see
// supabase/migrations/0009_personal_mode.sql) — this context is UI/nav only.

import { createContext, useCallback, useContext, useState } from "react";
import { useRouter, usePathname } from "next/navigation";

export type AppMode = "team" | "personal";

export interface ModeTransitionState {
  target: AppMode;
  leaving: boolean;
}

interface PersonalModeContextValue {
  mode: AppMode;
  goPersonal: () => void;
  goTeam: () => void;
  transition: ModeTransitionState | null;
}

const PersonalModeContext = createContext<PersonalModeContextValue>({
  mode: "team",
  goPersonal: () => {},
  goTeam: () => {},
  transition: null,
});

const COVER_MS = 260; // time for the wipe to fully cover the screen before we swap routes
const SETTLE_MS = 70; // one extra beat after router.push so the new route has painted before revealing
const REVEAL_MS = 340; // matches the .leaving wipe-out animation duration in globals.css

export function PersonalModeProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const mode: AppMode = pathname?.startsWith("/personal") ? "personal" : "team";
  const [transition, setTransition] = useState<ModeTransitionState | null>(null);

  const navigate = useCallback(
    (target: AppMode, href: string) => {
      setTransition((current) => {
        if (current) return current; // already mid-switch — ignore a double tap
        return { target, leaving: false };
      });
      window.setTimeout(() => {
        router.push(href);
        window.setTimeout(() => {
          setTransition((t) => (t ? { ...t, leaving: true } : t));
          window.setTimeout(() => setTransition(null), REVEAL_MS);
        }, SETTLE_MS);
      }, COVER_MS);
    },
    [router]
  );

  const goPersonal = useCallback(() => navigate("personal", "/personal"), [navigate]);
  const goTeam = useCallback(() => navigate("team", "/"), [navigate]);

  return (
    <PersonalModeContext.Provider value={{ mode, goPersonal, goTeam, transition }}>
      {children}
    </PersonalModeContext.Provider>
  );
}

export function usePersonalMode() {
  return useContext(PersonalModeContext);
}
