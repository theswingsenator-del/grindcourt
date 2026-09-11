"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/lib/useSession";
import { supabase } from "@/lib/supabase";
import { JudgeChatMessage } from "@/lib/types";
import BottomNav from "@/components/BottomNav";

interface ChatEntry {
  id: string;
  role: "user" | "assistant";
  content: string;
  actionSummary: string | null;
}

export default function TalkPage() {
  const router = useRouter();
  const { appUser, loading: sessionLoading } = useSession();
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    async function loadHistory() {
      if (!appUser) return;
      const { data } = await supabase
        .from("judge_chat_messages")
        .select("*")
        .eq("user_id", appUser.id)
        .order("created_at", { ascending: false })
        .limit(30);
      const rows = ((data ?? []) as JudgeChatMessage[]).reverse();
      setEntries(
        rows.map((r) => ({
          id: r.id,
          role: r.role,
          content: r.content,
          actionSummary: r.role === "assistant" && r.action_json ? summarizeStoredAction(r.action_json) : null,
        }))
      );
      setLoadingHistory(false);
    }
    if (appUser) loadHistory();
  }, [appUser]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [entries]);

  function summarizeStoredAction(action: JudgeChatMessage["action_json"]): string | null {
    if (!action) return null;
    switch (action.type) {
      case "reassign_task":
        return "Reassigned a task";
      case "edit_task":
        return "Edited a task";
      case "create_task":
        return "Created a task";
      case "hold_task":
        return action.approval_status === "pending" ? "Held a task" : "Released a task hold";
      default:
        return null;
    }
  }

  async function send() {
    const message = input.trim();
    if (!message || sending) return;
    setSending(true);
    setInput("");
    setEntries((prev) => [...prev, { id: `local-${Date.now()}`, role: "user", content: message, actionSummary: null }]);

    const res = await fetch("/api/talk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });
    const json = await res.json();
    setSending(false);

    setEntries((prev) => [
      ...prev,
      {
        id: `local-reply-${Date.now()}`,
        role: "assistant",
        content: json.reply ?? "Something went wrong.",
        actionSummary: json.action_taken ?? null,
      },
    ]);
  }

  if (sessionLoading || loadingHistory) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4">
        <div className="w-9 h-9 rounded-full border-2 border-ink-faint/25 border-t-ink animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col">
      <div className="flex-1 flex flex-col px-5 pt-[calc(1.4rem+env(safe-area-inset-top))] pb-3 gap-4 max-w-md w-full mx-auto min-h-0">
        <header className="rise rise-1 flex items-center justify-between">
          <div>
            <button onClick={() => router.back()} className="label mb-1 block">&larr; Back</button>
            <div className="ai-line">
              <div className="ai-orb" />
              <span>Talk to the Judge</span>
            </div>
          </div>
        </header>

        {/* Conversation feed — the Judge's own lines read as plain speech
            under its ai-line marker (no bubble/panel behind them, matching
            how the Judge/Assistant "speaks" everywhere else in the app).
            Only the user's own messages keep a solid filled bubble, which
            is the one legitimate box left on this screen — it distinguishes
            "you said this" from the rest of the page, it isn't decorative
            panel-stacking. */}
        <div className="flex-1 overflow-y-auto flex flex-col gap-4 min-h-0">
          {entries.length === 0 && (
            <div className="flex flex-col items-center text-center gap-2 py-10">
              <div className="ai-orb" />
              <p className="text-ink-dim text-sm font-medium max-w-64">
                Ask to reassign, edit, or create a task — or just talk it through.
              </p>
            </div>
          )}
          {entries.map((e) =>
            e.role === "user" ? (
              <div key={e.id} className="flex flex-col items-end">
                <div className="rounded-2xl px-4 py-3 max-w-[85%] text-[13.5px] leading-snug bg-ink text-ground font-medium">
                  {e.content}
                </div>
              </div>
            ) : (
              <div key={e.id} className="flex flex-col items-start gap-1">
                <div className="ai-line">
                  <div className="ai-orb" style={{ width: 14, height: 14 }} />
                  <span>The Judge</span>
                </div>
                <p className="text-[13.5px] leading-snug text-ink max-w-[90%] pl-0.5">{e.content}</p>
                {e.actionSummary && (
                  <p className="text-[11.5px] text-verdict font-bold pl-0.5">✓ {e.actionSummary}</p>
                )}
              </div>
            )
          )}
          <div ref={bottomRef} />
        </div>

        <div className="flex gap-2 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder="Talk to the Judge..."
            className="panel rounded-xl px-4 py-3 outline-none focus:border-ink/30 transition placeholder:text-ink-faint text-ink text-sm flex-1 min-w-0"
          />
          <button
            onClick={send}
            disabled={sending || !input.trim()}
            className="btn-verdict rounded-xl px-4 font-extrabold disabled:opacity-50 active:scale-[0.98] transition-transform shrink-0"
          >
            {sending ? "..." : "Send"}
          </button>
        </div>
      </div>
      <BottomNav />
    </div>
  );
}
