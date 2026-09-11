"use client";

// Resolves the logged-in Supabase Auth user AND their app_users row (which
// carries display_name/slot). Every page that needs "who am I" uses this.

import { useEffect, useState } from "react";
import { supabase } from "./supabase";
import { AppUser } from "./types";

export function useSession() {
  const [appUser, setAppUser] = useState<AppUser | null>(null);
  const [partner, setPartner] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        if (!cancelled) {
          setAppUser(null);
          setPartner(null);
          setLoading(false);
        }
        return;
      }
      const { data: users } = await supabase.from("app_users").select("*");
      if (cancelled) return;
      const me = (users ?? []).find((u) => u.id === user.id) ?? null;
      const other = (users ?? []).find((u) => u.id !== user.id) ?? null;
      setAppUser(me);
      setPartner(other);
      setLoading(false);
    }

    load();
    const { data: sub } = supabase.auth.onAuthStateChange(() => load());
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  async function signOut() {
    await supabase.auth.signOut();
  }

  return { appUser, partner, loading, signOut };
}
