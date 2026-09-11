"use client";

// Client-side push subscription management.

import { useEffect, useState } from "react";

export type NotifStatus = "unsupported" | "denied" | "default" | "subscribed" | "granted_unsubscribed";

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

export function useNotifications() {
  const [status, setStatus] = useState<NotifStatus>("default");
  const [busy, setBusy] = useState(false);
  // Real permission status is only known after the first async refresh()
  // resolves. Rendering an "Enable push" CTA off the initial "default"
  // state means it flashes on screen and then disappears the instant the
  // real status (often already "subscribed") comes back — exactly the
  // flash-then-different-content bug reported on the Inbox page. Callers
  // should gate the CTA on `ready`, not just `status`.
  const [ready, setReady] = useState(false);

  async function refresh() {
    try {
      if (
        typeof window === "undefined" ||
        !("Notification" in window) ||
        !("serviceWorker" in navigator) ||
        !("PushManager" in window)
      ) {
        setStatus("unsupported");
        return;
      }
      if (Notification.permission === "denied") {
        setStatus("denied");
        return;
      }
      if (Notification.permission === "default") {
        setStatus("default");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      setStatus(sub ? "subscribed" : "granted_unsubscribed");
    } finally {
      setReady(true);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function subscribe(): Promise<boolean> {
    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        await refresh();
        return false;
      }
      const reg = await navigator.serviceWorker.ready;
      const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!key) return false;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key) as BufferSource,
      });
      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sub.toJSON()),
      });
      await refresh();
      return res.ok;
    } catch {
      await refresh();
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function unsubscribe() {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await fetch("/api/push/subscribe", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function sendTest(): Promise<boolean> {
    const res = await fetch("/api/push/test", { method: "POST" });
    if (!res.ok) return false;
    const data = await res.json();
    return data.sent > 0;
  }

  return { status, ready, busy, subscribe, unsubscribe, sendTest };
}
