"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";

// GrindCourt logs in by username, not email — Supabase Auth requires a
// validly-shaped email under the hood, so each username maps to one here.
// The user never sees or types the right-hand side.
const USERNAME_TO_AUTH_EMAIL: Record<string, string> = {
  "gc@jay.26": "gc.jay.26@grindcourt.local",
  "gc@sam.26": "gc.sam.26@grindcourt.local",
};

function LoginForm() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);
  const router = useRouter();
  const params = useSearchParams();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setChecking(true);
    setError("");
    const email = USERNAME_TO_AUTH_EMAIL[username.trim()];
    if (!email) {
      setError("Wrong credentials. No public signup — ask the other partner if you're locked out.");
      setChecking(false);
      return;
    }
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    if (signInError) {
      setError("Wrong credentials. No public signup — ask the other partner if you're locked out.");
      setChecking(false);
      return;
    }
    router.push(params.get("from") ?? "/");
    router.refresh();
  }

  return (
    <div className="w-full max-w-xs flex flex-col gap-6 rise">
      <div className="text-center flex flex-col items-center gap-5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/icons/icon-192.png"
          alt="GrindCourt"
          className="w-24 h-24 rounded-3xl shadow-[0_18px_40px_-12px_rgba(232,64,47,0.4)]"
        />
        <div>
          <p className="label mb-2">GrindCourt</p>
          <h1 className="display text-4xl font-bold text-ink leading-[0.95]">
            State your<br />case.
          </h1>
          <p className="text-ink-faint text-[13px] mt-3 font-medium">No mercy. No excuses. No rest earned undone.</p>
        </div>
      </div>

      <form onSubmit={submit} className="flex flex-col gap-4">
        <input
          type="text"
          autoComplete="username"
          autoFocus
          required
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="Username"
          className="panel rounded-xl px-4 py-3.5 outline-none focus:border-ink/30 transition placeholder:text-ink-faint text-ink"
        />
        <input
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          className="panel rounded-xl px-4 py-3.5 outline-none focus:border-ink/30 transition placeholder:text-ink-faint text-ink"
        />
        {error && <p className="text-red text-sm text-center font-semibold">{error}</p>}
        <button
          type="submit"
          disabled={checking}
          className="btn-verdict font-extrabold rounded-xl py-4 active:scale-[0.98] transition-transform disabled:opacity-60"
        >
          {checking ? "Verifying..." : "Report for duty"}
        </button>
      </form>
    </div>
  );
}

export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center px-6">
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </div>
  );
}
