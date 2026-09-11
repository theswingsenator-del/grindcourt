"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "@/lib/useSession";
import { useRealtimeQuery } from "@/lib/useRealtimeTable";
import { useNotifications } from "@/lib/useNotifications";
import { supabase } from "@/lib/supabase";
import { AppNotification, FoundersUpdate, TaskCheckin, Task } from "@/lib/types";
import BottomNav from "@/components/BottomNav";

interface InboxData {
  notifications: AppNotification[];
  latestUpdate: FoundersUpdate | null;
  openCheckins: TaskCheckin[];
  tasksById: Map<string, Task>;
}

async function fetchNotifications(userId: string | undefined): Promise<InboxData> {
  if (!userId) return { notifications: [], latestUpdate: null, openCheckins: [], tasksById: new Map() };
  const [{ data }, { data: updates }, { data: checkins }] = await Promise.all([
    supabase
      .from("notifications")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(100),
    supabase.from("founders_updates").select("*").order("week_start", { ascending: false }).limit(1),
    supabase
      .from("task_checkins")
      .select("*")
      .eq("user_id", userId)
      .is("response_text", null)
      .order("prompted_at", { ascending: false }),
  ]);

  const openCheckins = checkins ?? [];
  const taskIds = [...new Set(openCheckins.map((c) => c.task_id))];
  const tasksById = new Map<string, Task>();
  if (taskIds.length > 0) {
    const { data: tasks } = await supabase.from("tasks").select("*").in("id", taskIds);
    for (const t of tasks ?? []) tasksById.set(t.id, t);
  }

  return { notifications: data ?? [], latestUpdate: updates?.[0] ?? null, openCheckins, tasksById };
}

const ASSESSMENT_LABEL: Record<string, string> = {
  on_track: "Logged — on track",
  short: "Logged — follow-ups added",
  unclear: "Logged",
};

function CheckinCard({ checkin, task, onReload }: { checkin: TaskCheckin; task: Task | undefined; onReload: () => void }) {
  const [responseText, setResponseText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const [result, setResult] = useState<{ assessment: string; follow_ups_created: number } | null>(null);

  async function submit() {
    if (!responseText.trim()) return;
    setSubmitting(true);
    const res = await fetch("/api/tasks/checkin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ checkin_id: checkin.id, response_text: responseText.trim() }),
    });
    const data = await res.json().catch(() => null);
    setSubmitting(false);
    if (data?.ok) {
      setResult({ assessment: data.assessment, follow_ups_created: data.follow_ups_created ?? 0 });
      onReload();
    }
  }

  async function dismiss() {
    setDismissing(true);
    await fetch("/api/tasks/checkin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ checkin_id: checkin.id, response_text: "(dismissed)", dismiss: true }),
    });
    onReload();
  }

  const resultLine =
    result &&
    (result.assessment === "short" && result.follow_ups_created > 0
      ? `Logged — ${result.follow_ups_created} follow-up${result.follow_ups_created > 1 ? "s" : ""} added`
      : ASSESSMENT_LABEL[result.assessment] ?? "Logged");

  return (
    <div className="panel-strong rounded-xl px-4 py-3.5 flex flex-col gap-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="ai-line">
          <div className="ai-orb" />
          <span>The Planner asks</span>
        </div>
        {!resultLine && (
          <button
            onClick={dismiss}
            disabled={dismissing}
            className="text-[11px] text-ink-faint font-semibold shrink-0 disabled:opacity-50"
          >
            Dismiss
          </button>
        )}
      </div>
      <p className="text-[12.5px] font-semibold text-ink leading-snug">
        Did &quot;{task?.title ?? "that task"}&quot; actually land, or did it come up short?
      </p>
      {resultLine ? (
        <p className="text-[12px] text-ink-dim font-semibold">{resultLine}</p>
      ) : (
        <div className="flex flex-col gap-2">
          <textarea
            value={responseText}
            onChange={(e) => setResponseText(e.target.value)}
            placeholder="What actually happened?"
            rows={2}
            className="panel rounded-lg px-3 py-2.5 outline-none text-sm text-ink placeholder:text-ink-faint"
          />
          <button
            onClick={submit}
            disabled={submitting || !responseText.trim()}
            className="btn-verdict rounded-lg py-2.5 text-xs font-extrabold disabled:opacity-50"
          >
            {submitting ? "Logging..." : "Submit"}
          </button>
        </div>
      )}
    </div>
  );
}

function IconGear() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" strokeWidth="1.8" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3.25" />
      <path d="M19.4 13.5a7.6 7.6 0 0 0 0-3l2-1.4-2-3.4-2.3.8a7.6 7.6 0 0 0-2.6-1.5L14 2.5h-4l-.5 2.5a7.6 7.6 0 0 0-2.6 1.5l-2.3-.8-2 3.4 2 1.4a7.6 7.6 0 0 0 0 3l-2 1.4 2 3.4 2.3-.8a7.6 7.6 0 0 0 2.6 1.5l.5 2.5h4l.5-2.5a7.6 7.6 0 0 0 2.6-1.5l2.3.8 2-3.4z" />
    </svg>
  );
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function NotificationsPage() {
  const { appUser, signOut } = useSession();
  const { data, reload } = useRealtimeQuery(
    ["notifications", "founders_updates", "task_checkins"],
    () => fetchNotifications(appUser?.id),
    [appUser?.id]
  );
  const notifications = data?.notifications;
  const push = useNotifications();
  const router = useRouter();

  async function handleSignOut() {
    await signOut();
    router.push("/login");
  }

  useEffect(() => {
    if (!notifications || !appUser) return;
    const unreadIds = notifications.filter((n) => !n.read).map((n) => n.id);
    if (unreadIds.length === 0) return;
    supabase
      .from("notifications")
      .update({ read: true })
      .in("id", unreadIds)
      .then(() => reload());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notifications?.length]);

  return (
    <div className="flex-1 flex flex-col">
      <div className="flex-1 flex flex-col px-5 pt-[calc(1.4rem+env(safe-area-inset-top))] pb-28 gap-5 max-w-md w-full mx-auto">
        <header className="rise rise-1 flex items-start justify-between gap-3">
          <div>
            <p className="label mb-1">Inbox</p>
            <h1 className="display text-2xl font-bold">Everything on record.</h1>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Link href="/settings" className="btn-ghost rounded-lg p-2 flex items-center justify-center" aria-label="Board Conduct settings">
              <IconGear />
            </Link>
            <button onClick={handleSignOut} className="btn-ghost rounded-lg px-3 py-2 text-[11px] font-bold">
              Sign out
            </button>
          </div>
        </header>

        {data?.latestUpdate && (
          <div className="rise rise-2 carousel">
            <Link
              href="/updates"
              className="carousel-card rounded-2xl p-4 flex flex-col justify-between gap-6 active:scale-[0.98] transition-transform min-h-32"
              style={{ background: "var(--accent)" }}
            >
              <div className="w-9 h-9 rounded-full flex items-center justify-center" style={{ background: "color-mix(in srgb, var(--accent-ink) 14%, transparent)" }}>
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: "var(--accent-ink)" }} />
              </div>
              <div>
                <p className="text-[13.5px] font-extrabold" style={{ color: "var(--accent-ink)" }}>The Narrator</p>
                <p className="text-[10.5px] mt-0.5 leading-snug" style={{ color: "color-mix(in srgb, var(--accent-ink) 75%, transparent)" }}>
                  This week&apos;s Founders&apos; Update is ready.
                </p>
              </div>
            </Link>
          </div>
        )}

        {data && data.openCheckins.length > 0 && (
          <section className="rise rise-2 flex flex-col gap-3">
            <p className="label">Needs your input</p>
            {data.openCheckins.map((c) => (
              <CheckinCard key={c.id} checkin={c} task={data.tasksById.get(c.task_id)} onReload={reload} />
            ))}
          </section>
        )}

        <section className="rise rise-3">
          <p className="label mb-2">Updates</p>
          {(!notifications || notifications.length === 0) && (
            <div className="px-1 py-8 text-center">
              <p className="text-ink-dim text-sm font-medium">Nothing yet.</p>
            </div>
          )}
          <div className="flex flex-col">
            {notifications?.map((n) => (
              <div key={n.id} className="list-row items-start">
                <div className="flex-1 min-w-0">
                  <p className={`text-[13.5px] font-bold ${!n.read ? "text-ink" : "text-ink-dim"}`}>{n.title}</p>
                  <p className="text-[12.5px] text-ink-dim mt-1 leading-snug">{n.body}</p>
                </div>
                <div className="shrink-0 flex flex-col items-end gap-1.5">
                  {!n.read && <span className="w-1.5 h-1.5 rounded-full bg-red" />}
                  <span className="text-[10px] text-ink-faint">{timeAgo(n.created_at)}</span>
                </div>
              </div>
            ))}
          </div>
        </section>

        {push.ready && push.status !== "subscribed" && push.status !== "unsupported" && (
          <button
            onClick={push.subscribe}
            disabled={push.busy}
            className="btn-ghost rounded-xl py-3 text-sm font-bold disabled:opacity-50"
          >
            {push.busy ? "Enabling..." : "Enable push notifications"}
          </button>
        )}
      </div>
      <BottomNav />
    </div>
  );
}
