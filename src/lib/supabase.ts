// Browser Supabase client — anon key, RLS-scoped (authenticated-read-all).
// Used by client components for auth, reads, and Realtime subscriptions.
// All writes go through /api/* routes (service role), never through this client.

import { createBrowserClient } from "@supabase/ssr";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "placeholder";

// True once real env vars are set — pages skip DB calls when false
// so the UI never hangs waiting on a dead placeholder host.
export const dbConfigured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL);

export function createSupabaseBrowserClient() {
  return createBrowserClient(url, anonKey);
}

// Singleton for client components that don't need a fresh instance per call.
export const supabase = createSupabaseBrowserClient();
