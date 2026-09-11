// Server-side Supabase clients.
//
// createSupabaseServerClient() — cookie-bound, anon key, used in Server
// Components / route handlers that need to know WHO is logged in (reads
// the Supabase Auth session from cookies set by the browser client).
//
// createSupabaseAdminClient() — service-role key, bypasses RLS entirely.
// Every API route that writes to the database uses this one, after first
// verifying the caller's session with createSupabaseServerClient(). This
// keeps all fine/ladder/violation business logic server-authoritative.

import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "placeholder";

export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component render — middleware refreshes
          // the session cookie instead. Safe to ignore.
        }
      },
    },
  });
}

export function createSupabaseAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key || !process.env.NEXT_PUBLIC_SUPABASE_URL) return null;
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// Resolves the app_users row for the currently authenticated session, or
// null if unauthenticated / not yet seeded. Used at the top of every
// mutating API route to know which partner is acting.
export async function getCurrentAppUser() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const admin = createSupabaseAdminClient();
  if (!admin) return null;
  const { data } = await admin.from("app_users").select("*").eq("id", user.id).maybeSingle();
  return data;
}
