"use client";

// Generic "subscribe to a table, refetch a query on any change" hook.
// Used across the dashboard/goals/fines pages so every partner's changes
// show up live for the other without a manual refresh.

import { useEffect, useRef, useState } from "react";
import { supabase } from "./supabase";

export function useRealtimeQuery<T>(
  tables: string[],
  fetcher: () => Promise<T>,
  deps: unknown[] = []
) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);

  // Always call the latest fetcher without making it a lint-unsafe
  // dependency — callers pass a fresh closure every render.
  const fetcherRef = useRef(fetcher);
  useEffect(() => {
    fetcherRef.current = fetcher;
  });

  const tablesKey = tables.join(",");
  const depsKey = JSON.stringify(deps);

  async function reload() {
    const result = await fetcherRef.current();
    setData(result);
    setLoading(false);
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depsKey]);

  useEffect(() => {
    const channel = supabase.channel(`rt-${tablesKey}-${Math.random().toString(36).slice(2)}`);
    for (const table of tables.slice()) {
      channel.on("postgres_changes", { event: "*", schema: "public", table }, () => reload());
    }
    channel.subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tablesKey]);

  return { data, loading, reload, setData };
}
