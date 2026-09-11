"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { NagTone, ConductSettings } from "@/lib/types";
import { useSession } from "@/lib/useSession";
import { usePersonalMode } from "@/lib/PersonalModeContext";
import { friendlyTimezoneLabel } from "@/lib/tzLabel";
import BottomNav from "@/components/BottomNav";

const TONE_OPTIONS: { value: NagTone; label: string }[] = [
  { value: "blunt", label: "Blunt" },
  { value: "roast", label: "Roast" },
  { value: "formal", label: "Formal" },
];

function IconGlobeSmall() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" strokeWidth="1.8" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17M12 3.5c2.6 2.4 4 5.4 4 8.5s-1.4 6.1-4 8.5c-2.6-2.4-4-5.4-4-8.5s1.4-6.1 4-8.5z" />
    </svg>
  );
}

export default function SettingsPage() {
  const router = useRouter();
  const { appUser, partner } = useSession();
  const { goPersonal } = usePersonalMode();
  const [settings, setSettings] = useState<ConductSettings | null>(null);
  const [auditorSampleSize, setAuditorSampleSize] = useState(0);
  const [pushSubCount, setPushSubCount] = useState(0);
  const [lastPushSentCount, setLastPushSentCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sendingTest, setSendingTest] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/settings");
    if (res.status === 401) {
      router.push("/login");
      return;
    }
    const json = await res.json();
    setSettings(json.settings ?? null);
    setAuditorSampleSize(json.auditor_sample_size ?? 0);
    setPushSubCount(json.push_subscription_count ?? 0);
    setLastPushSentCount(json.last_notification_push_sent_count ?? null);
    setLoading(false);
  }

  async function sendTestPush() {
    setSendingTest(true);
    setTestResult(null);
    const res = await fetch("/api/push/test", { method: "POST" });
    const json = await res.json();
    setSendingTest(false);
    setTestResult(
      json.sent > 0
        ? `Sent to ${json.sent} device${json.sent > 1 ? "s" : ""}.`
        : "Nothing delivered — no registered device, or push failed."
    );
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function updateSetting(patch: Partial<Pick<ConductSettings, "nag_tone" | "predictor_enabled">>) {
    setSaving(true);
    const res = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const json = await res.json();
    setSaving(false);
    if (json.settings) setSettings(json.settings);
  }

  if (loading || !settings) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4">
        <div className="w-9 h-9 rounded-full border-2 border-ink-faint/25 border-t-ink animate-spin" />
      </div>
    );
  }

  const auditorCapped = Math.min(auditorSampleSize, 6);
  const auditorActive = auditorSampleSize >= 6;

  return (
    <div className="flex-1 flex flex-col">
      <div className="flex-1 flex flex-col px-5 pt-[calc(1.4rem+env(safe-area-inset-top))] pb-28 gap-6 max-w-md w-full mx-auto">
        <header className="rise rise-1">
          <p className="label mb-1">Board Conduct</p>
          <h1 className="display-hero text-2xl">How hard should it come at you?</h1>
          {appUser?.timezone && (
            <p className="text-[11.5px] text-ink-faint mt-2">
              Your day resets at 12:00 AM {friendlyTimezoneLabel(appUser.timezone)}.
            </p>
          )}
        </header>

        {/* De-boxed settings — toggle-rows separate with spacing, not a
            .panel wrapper (matches the "settings rows" convention in
            globals.css: no hairline, extra vertical padding does the work).
            Three related conduct controls consolidated under one heading
            instead of one box per row. */}
        <section className="rise rise-2">
          <h2 className="text-[13px] font-bold text-ink-dim uppercase tracking-[0.08em] px-1 mb-1">Board conduct</h2>
          <div className="flex flex-col">
            <div className="toggle-row">
              <div>
                <p className="text-[13.5px] font-bold">Nag tone</p>
                <p className="text-[11.5px] text-ink-dim mt-0.5">Controls the Police&apos;s voice on your fines.</p>
              </div>
              <div className="segpill-group shrink-0">
                {TONE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => updateSetting({ nag_tone: opt.value })}
                    disabled={saving}
                    className={`segpill ${settings.nag_tone === opt.value ? "active" : ""}`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="toggle-row">
              <div>
                <p className="text-[13.5px] font-bold">Predictor nudges</p>
                <p className="text-[11.5px] text-ink-dim mt-0.5">Pre-emptive heads-up before your usual miss day.</p>
              </div>
              <div className="segpill-group shrink-0">
                <button
                  onClick={() => updateSetting({ predictor_enabled: true })}
                  disabled={saving}
                  className={`segpill ${settings.predictor_enabled ? "active" : ""}`}
                >
                  On
                </button>
                <button
                  onClick={() => updateSetting({ predictor_enabled: false })}
                  disabled={saving}
                  className={`segpill ${!settings.predictor_enabled ? "active" : ""}`}
                >
                  Off
                </button>
              </div>
            </div>

            <div className="toggle-row">
              <div>
                <p className="text-[13.5px] font-bold">Auditor</p>
                <p className="text-[11.5px] text-ink-dim mt-0.5">Informational only — not user-controlled.</p>
              </div>
              <span className="label shrink-0">
                {auditorActive ? "Active" : `Learning — ${auditorCapped} of 6 logged`}
              </span>
            </div>
          </div>
        </section>

        {/* Push notifications — this is genuinely list-shaped (one device
            registration status + a test action), so it takes the boxless
            .list-row treatment: content left, action right, hairline
            separator — same primitive the brief calls out for a "linked
            devices/session list". */}
        <section className="rise rise-3">
          <h2 className="text-[13px] font-bold text-ink-dim uppercase tracking-[0.08em] px-1 mb-1">Notifications</h2>
          <div className="flex flex-col">
            <div className="list-row items-start">
              <div className="flex-1 min-w-0">
                <p className="text-[13.5px] font-bold">Push notifications</p>
                <p className={`text-[11.5px] mt-0.5 ${pushSubCount === 0 ? "text-red font-semibold" : "text-ink-dim"}`}>
                  {pushSubCount === 0
                    ? "No device registered — reinstall the app and allow notifications."
                    : `${pushSubCount} device${pushSubCount > 1 ? "s" : ""} registered.`}
                </p>
                {pushSubCount > 0 && lastPushSentCount === 0 && (
                  <p className="text-[11px] text-amber font-semibold mt-1">
                    Last notification didn&apos;t reach any device — push may be broken.
                  </p>
                )}
                {testResult && <p className="text-[11px] text-ink-dim mt-1">{testResult}</p>}
              </div>
              <button
                onClick={sendTestPush}
                disabled={sendingTest}
                className="btn-ghost rounded-lg px-3 py-2 text-[11px] font-bold shrink-0 disabled:opacity-50"
              >
                {sendingTest ? "Sending..." : "Send test push"}
              </button>
            </div>
          </div>
        </section>

        {/* Personal mode entry point — recomposed as an icon-led feature
            tile (same visual grammar as the dashboard's carousel-card entry
            points: icon-in-circle, bold title, quiet line) with its own
            explanatory copy underneath, whole card acting as the on-ramp
            rather than a paragraph block with a trailing button. */}
        <section className="rise rise-4 panel-strong rounded-2xl p-5 flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0" style={{ background: "color-mix(in srgb, var(--accent) 18%, transparent)" }}>
              <IconGlobeSmall />
            </div>
            <div className="min-w-0">
              <p className="text-[13.5px] font-bold text-ink">Personal — a space of its own</p>
              <p className="text-[11px] text-ink-dim mt-0.5">Its own globe. Nothing here is shared.</p>
            </div>
          </div>
          <p className="text-[12px] text-ink-dim leading-snug">
            Personal isn&apos;t a filtered view of this app anymore — it&apos;s its own globe, with its own nav, its own
            look, and its own docket/goals/stakes. {partner?.display_name ?? "Your partner"} never sees any of it, never gets
            notified about it, and can&apos;t fetch it from the database even directly — enforced by the same row-level
            security that keeps fines and proof honest, not just the app hiding a screen.
          </p>
          <p className="text-[12px] text-ink-dim leading-snug">
            Over there you set your own stakes on your own tasks — no ladder, no AI Judge, no dispute. You mark a stake paid
            or waive it yourself, honor system, because there&apos;s nobody else in the room.
          </p>
          <button
            onClick={goPersonal}
            className="btn-ghost rounded-xl py-3 text-sm font-bold active:scale-[0.98] transition-transform"
          >
            Enter Personal &rarr;
          </button>
        </section>
      </div>
      <BottomNav />
    </div>
  );
}
