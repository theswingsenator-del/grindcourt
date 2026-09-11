"use client";

// Auto-detects mobile browser vs installed app. Guides install:
// Android/Chrome -> native beforeinstallprompt; iOS Safari -> step sheet.

import { useEffect, useState } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISS_KEY = "gc_install_dismissed_at";
const DISMISS_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

function isStandalone(): boolean {
  if (typeof window === "undefined") return true;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

function isMobile(): boolean {
  if (typeof navigator === "undefined") return false;
  return /android|iphone|ipad|ipod/i.test(navigator.userAgent);
}

export default function InstallPrompt() {
  const [visible, setVisible] = useState(false);
  const [ios, setIos] = useState(false);
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIosSteps, setShowIosSteps] = useState(false);

  useEffect(() => {
    if (isStandalone() || !isMobile()) return;
    const dismissedAt = Number(localStorage.getItem(DISMISS_KEY) ?? 0);
    if (Date.now() - dismissedAt < DISMISS_COOLDOWN_MS) return;

    setIos(isIOS());
    if (isIOS()) {
      setVisible(true);
    } else {
      const handler = (e: Event) => {
        e.preventDefault();
        setDeferred(e as BeforeInstallPromptEvent);
        setVisible(true);
      };
      window.addEventListener("beforeinstallprompt", handler);
      return () => window.removeEventListener("beforeinstallprompt", handler);
    }
  }, []);

  function dismiss() {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
    setVisible(false);
    setShowIosSteps(false);
  }

  async function install() {
    if (ios) {
      setShowIosSteps(true);
      return;
    }
    if (deferred) {
      await deferred.prompt();
      const choice = await deferred.userChoice;
      if (choice.outcome === "accepted") setVisible(false);
      else dismiss();
    }
  }

  if (!visible) return null;

  return (
    <>
      <div className="fixed bottom-[92px] left-0 right-0 z-40 px-4">
        <div className="panel-strong rounded-2xl px-4 py-3.5 max-w-md mx-auto flex items-center gap-3 shadow-[0_12px_44px_-8px_rgba(0,0,0,0.9)]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icons/icon-192.png" alt="" className="w-10 h-10 rounded-xl shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-bold">Put GrindCourt on your home screen</p>
            <p className="text-[11px] text-ink-faint">Full app. Nags don&apos;t stop for browser tabs.</p>
          </div>
          <button onClick={install} className="btn-verdict rounded-xl px-3.5 py-2 text-xs font-extrabold shrink-0 active:scale-95 transition-transform">
            Install
          </button>
          <button onClick={dismiss} aria-label="Dismiss" className="text-ink-faint text-lg px-1 shrink-0">
            ×
          </button>
        </div>
      </div>

      {showIosSteps && (
        <div className="fixed inset-0 z-[60] bg-black/75 backdrop-blur-sm flex items-end" onClick={dismiss}>
          <div
            className="w-full max-w-md mx-auto panel-strong rounded-t-3xl px-6 pt-6 pb-[calc(2rem+env(safe-area-inset-bottom))]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-10 h-1 rounded-full bg-ink-faint/30 mx-auto mb-5" />
            <p className="label mb-2">Install on iPhone</p>
            <h2 className="display text-xl font-bold mb-5">Three taps. No App Store.</h2>
            <ol className="flex flex-col gap-4 text-sm">
              <li className="flex items-center gap-3.5">
                <span className="w-8 h-8 rounded-xl panel flex items-center justify-center font-extrabold text-ink shrink-0">1</span>
                <p>
                  Tap the <strong>Share</strong> button
                  <span className="inline-block mx-1.5 px-2 py-0.5 rounded-md bg-surface-raised text-xs font-mono">⬆︎</span>
                  at the bottom of Safari
                </p>
              </li>
              <li className="flex items-center gap-3.5">
                <span className="w-8 h-8 rounded-xl panel flex items-center justify-center font-extrabold text-ink shrink-0">2</span>
                <p>Scroll down, tap <strong>&ldquo;Add to Home Screen&rdquo;</strong></p>
              </li>
              <li className="flex items-center gap-3.5">
                <span className="w-8 h-8 rounded-xl panel flex items-center justify-center font-extrabold text-ink shrink-0">3</span>
                <p>Tap <strong>Add</strong>. Open it from the home screen — that unlocks notifications.</p>
              </li>
            </ol>
            <button onClick={dismiss} className="mt-6 w-full panel rounded-2xl py-3.5 text-sm font-bold text-ink-dim">
              Got it
            </button>
          </div>
        </div>
      )}
    </>
  );
}
