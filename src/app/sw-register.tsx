"use client";

import { useEffect } from "react";

// If someone has a tab open across a redeploy, their already-loaded HTML
// can end up referencing a JS chunk that no longer exists on the server
// (chunk hashes change every build, old ones get replaced on deploy).
// When that happens React never finishes hydrating, so click/submit
// handlers silently never attach — forms fall back to raw native
// submission (e.g. POSTing straight to /login, which 404s) and buttons
// just look dead. A hard reload always fixes it since it fetches the
// current HTML + matching chunks. Detect that failure class and recover
// automatically instead of leaving the app looking broken. Guarded by
// sessionStorage so a genuinely broken deploy can't reload-loop forever.
function isChunkLoadFailure(message: string | undefined | null): boolean {
  if (!message) return false;
  return /loading chunk|chunkloaderror|failed to fetch dynamically imported module|importing a module script failed/i.test(
    message
  );
}

function selfHealOnce() {
  const key = "gc_chunk_reload_at";
  const last = Number(sessionStorage.getItem(key) || 0);
  if (Date.now() - last < 15000) return; // already tried recently, don't loop
  sessionStorage.setItem(key, String(Date.now()));
  window.location.reload();
}

export default function SwRegister() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }

    function onError(event: ErrorEvent) {
      if (isChunkLoadFailure(event.message)) selfHealOnce();
    }
    function onRejection(event: PromiseRejectionEvent) {
      const message = event.reason?.message ?? String(event.reason ?? "");
      if (isChunkLoadFailure(message)) selfHealOnce();
    }
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);
  return null;
}
