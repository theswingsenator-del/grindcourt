"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSession } from "@/lib/useSession";
import { useRealtimeQuery } from "@/lib/useRealtimeTable";
import { supabase } from "@/lib/supabase";
import { formatNaira } from "@/lib/fines";
import { violationLabel, severityLabel } from "@/lib/violationLabels";
import { localDateString } from "@/lib/timezone";
import { Fine, Violation, PaymentProof, FineBrief, Bid, Appeal, WarChestProject, WarChestProposal, WarChestPlea, AppUser, Task } from "@/lib/types";
import BottomNav from "@/components/BottomNav";

// ── Fines ────────────────────────────────────────────────────────────────

interface FinesData {
  fines: Fine[];
  violations: Violation[];
  proofs: PaymentProof[];
  briefs: FineBrief[];
  bids: Bid[];
  appeals: Appeal[];
  users: AppUser[];
  tasks: Task[];
}

async function fetchFines(): Promise<FinesData> {
  const [{ data: fines }, { data: violations }, { data: proofs }, { data: briefs }, { data: bids }, { data: appeals }, { data: users }, { data: tasks }] =
    await Promise.all([
      supabase.from("fines").select("*").order("created_at", { ascending: false }),
      supabase.from("violations").select("*"),
      supabase.from("payment_proofs").select("*"),
      supabase.from("fine_briefs").select("*"),
      supabase.from("bids").select("*"),
      supabase.from("appeals").select("*"),
      supabase.from("app_users").select("*"),
      supabase.from("tasks").select("*"),
    ]);
  return {
    fines: fines ?? [],
    violations: violations ?? [],
    proofs: proofs ?? [],
    briefs: briefs ?? [],
    bids: bids ?? [],
    appeals: appeals ?? [],
    users: users ?? [],
    tasks: tasks ?? [],
  };
}

function formatDetectedAt(iso: string, timezone: string | undefined): string {
  if (!timezone) return new Date(iso).toLocaleString();
  const day = localDateString(new Date(iso), timezone);
  const time = new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", minute: "2-digit" }).format(new Date(iso));
  return `${day} at ${time}`;
}

const STATUS_LABEL: Record<string, string> = {
  issued: "ISSUED",
  bid_pending: "BID PENDING",
  accepted: "OWED — PAY NOW",
  appealed: "APPEAL PENDING",
  paid_pending_proof: "AWAITING APPROVAL",
  paid_approved: "PAID",
  appeal_denied: "APPEAL DENIED — OWED",
  waived: "WAIVED",
};

const BRIEF_VERDICT_LABEL: Record<string, string> = {
  waive: "WAIVED",
  update_task: "WAIVED — TASK UPDATED",
  insist: "FINE STANDS",
};

const BID_STATUS_LABEL: Record<string, string> = {
  pending: "PENDING",
  accepted: "ACCEPTED",
  rejected: "REJECTED",
  countered: "COUNTERED",
};

function FineCard({
  fine,
  violation,
  proof,
  brief,
  bid,
  appeal,
  isMine,
  priorOffenseCount,
  onReload,
  finedUser,
  relatedTask,
}: {
  fine: Fine;
  violation: Violation | undefined;
  proof: PaymentProof | undefined;
  brief: FineBrief | undefined;
  bid: Bid | undefined;
  appeal: Appeal | undefined;
  isMine: boolean;
  priorOffenseCount: number;
  onReload: () => void;
  finedUser: AppUser | undefined;
  relatedTask: Task | undefined;
}) {
  const [showDetail, setShowDetail] = useState(false);
  const [showBid, setShowBid] = useState(false);
  const [bidAmount, setBidAmount] = useState("");
  const [bidReason, setBidReason] = useState("");
  const [bidding, setBidding] = useState(false);

  const [showAppeal, setShowAppeal] = useState(false);
  const [appealReason, setAppealReason] = useState("");
  const [appealing, setAppealing] = useState(false);

  const [showBrief, setShowBrief] = useState(false);
  const [briefText, setBriefText] = useState("");
  const [briefing, setBriefing] = useState(false);

  const [uploading, setUploading] = useState(false);
  const [approving, setApproving] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const canBid = isMine && fine.status === "issued";
  const canAppeal = isMine && fine.status === "issued" && priorOffenseCount === 0;
  const canBrief = isMine && fine.status === "issued";
  const canPay = isMine && (fine.status === "accepted" || fine.status === "appeal_denied" || fine.status === "issued");
  const awaitingMyApproval = !isMine && fine.status === "paid_pending_proof" && proof && !proof.approved_by_partner;

  async function submitBid() {
    const amount = Number(bidAmount);
    if (!amount || amount <= 0 || !bidReason.trim()) return;
    setBidding(true);
    await fetch("/api/fines/bid", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fine_id: fine.id, proposed_amount: amount, reason_text: bidReason.trim() }),
    });
    await onReload();
    setBidding(false);
  }

  async function submitAppeal() {
    if (!appealReason.trim()) return;
    setAppealing(true);
    await fetch("/api/fines/appeal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fine_id: fine.id, reason_text: appealReason.trim() }),
    });
    await onReload();
    setAppealing(false);
  }

  async function submitBrief() {
    if (!briefText.trim()) return;
    setBriefing(true);
    await fetch("/api/fines/brief", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fine_id: fine.id, brief_text: briefText.trim() }),
    });
    await onReload();
    setBriefing(false);
  }

  async function uploadProof(file: File) {
    setUploading(true);
    const form = new FormData();
    form.append("fine_id", fine.id);
    form.append("file", file);
    await fetch("/api/fines/proof", { method: "POST", body: form });
    setUploading(false);
    onReload();
  }

  async function approveProof() {
    if (!proof) return;
    setApproving(true);
    await fetch("/api/fines/approve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ proof_id: proof.id }),
    });
    setApproving(false);
    onReload();
  }

  return (
    <div className="card-fine rounded-2xl p-4 flex flex-col gap-2.5">
      <div className="ai-line">
        <div className="ai-orb" />
        <span>The Judge, ruling</span>
      </div>
      <button className="flex items-start justify-between gap-2 text-left" onClick={() => setShowDetail((v) => !v)}>
        <div>
          <p className="text-[11px] font-bold text-ink-dim uppercase tracking-wide">
            {violation?.type.replace(/_/g, " ") ?? "violation"} · rung {fine.rung}
          </p>
          <p className="money text-red text-3xl font-extrabold mt-0.5">{formatNaira(fine.amount)}</p>
        </div>
        <span className="label text-[9px] px-2 py-1 rounded-full bg-surface-raised shrink-0">{STATUS_LABEL[fine.status] ?? fine.status}</span>
      </button>
      {violation?.details && <p className="text-[12px] text-ink-dim leading-snug">{violation.details}</p>}

      {showDetail && violation && (
        <div className="panel rounded-xl px-3.5 py-3 flex flex-col gap-2 -mt-0.5">
          <p className="text-[11px] font-bold text-ink-dim uppercase tracking-wide">Why was I fined?</p>
          <p className="text-[13px] text-ink leading-snug">{violationLabel(violation.type)}</p>
          <div className="grid grid-cols-2 gap-2 text-[11.5px]">
            <div>
              <p className="label">Detected</p>
              <p className="text-ink-dim mt-0.5">{formatDetectedAt(violation.detected_at, finedUser?.timezone)}</p>
            </div>
            <div>
              <p className="label">Severity</p>
              <p className="text-ink-dim mt-0.5">{severityLabel(violation.severity)}</p>
            </div>
            <div>
              <p className="label">Streak # at time</p>
              <p className="text-ink-dim mt-0.5">{violation.streak_count_at_time}</p>
            </div>
            <div>
              <p className="label">Amount</p>
              <p className="text-ink-dim mt-0.5">{formatNaira(fine.amount)}</p>
            </div>
          </div>
          {violation.details && (
            <div>
              <p className="label">Details</p>
              <p className="text-ink-dim mt-0.5 leading-snug">{violation.details}</p>
            </div>
          )}
          {relatedTask && (
            <div>
              <p className="label">Related task</p>
              <Link href={`/task/${relatedTask.id}`} className="text-ink font-semibold underline text-[12.5px] mt-0.5 block">
                {relatedTask.title}
              </Link>
              {relatedTask.due_at && (
                <p className="text-ink-faint text-[11px] mt-0.5">Due {new Date(relatedTask.due_at).toLocaleString()}</p>
              )}
            </div>
          )}
        </div>
      )}

      {canBid && !showBid && !showAppeal && !showBrief && (
        <div className="flex flex-col gap-2 mt-1">
          <div className="flex gap-2">
            <button onClick={() => setShowBid(true)} className="btn-ghost flex-1 rounded-lg py-2.5 text-xs font-bold">
              Bid it down
            </button>
            {canAppeal && (
              <button onClick={() => setShowAppeal(true)} className="btn-ghost flex-1 rounded-lg py-2.5 text-xs font-bold">
                Appeal (1st offense)
              </button>
            )}
          </div>
          {canBrief && (
            <button onClick={() => setShowBrief(true)} className="btn-ghost w-full rounded-lg py-2.5 text-xs font-bold">
              Brief the Judge
            </button>
          )}
        </div>
      )}

      {showBid && !(bid && bid.status !== "pending") && (
        <div className="flex flex-col gap-2 mt-1">
          {bidding ? (
            <div className="ai-line px-0.5">
              <div className="ai-orb pulse-alert" style={{ width: 14, height: 14 }} />
              <span>The Judge is weighing it...</span>
            </div>
          ) : (
            <>
              <input
                type="number"
                value={bidAmount}
                onChange={(e) => setBidAmount(e.target.value)}
                placeholder="Proposed amount (₦)"
                className="panel rounded-lg px-3 py-2.5 outline-none text-sm text-ink placeholder:text-ink-faint"
              />
              <textarea
                value={bidReason}
                onChange={(e) => setBidReason(e.target.value)}
                placeholder="Why should this be lower?"
                rows={2}
                className="panel rounded-lg px-3 py-2.5 outline-none text-sm text-ink placeholder:text-ink-faint"
              />
              <div className="flex gap-2">
                <button onClick={submitBid} className="btn-verdict flex-1 rounded-lg py-2.5 text-xs font-extrabold">
                  Submit to Judge
                </button>
                <button onClick={() => setShowBid(false)} className="btn-ghost rounded-lg px-3 text-xs font-bold">
                  Cancel
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {showAppeal && !(appeal && appeal.ai_verdict) && (
        <div className="flex flex-col gap-2 mt-1">
          {appealing ? (
            <div className="ai-line px-0.5">
              <div className="ai-orb pulse-alert" style={{ width: 14, height: 14 }} />
              <span>The Judge is weighing it...</span>
            </div>
          ) : (
            <>
              <textarea
                value={appealReason}
                onChange={(e) => setAppealReason(e.target.value)}
                placeholder="What's the genuine reason? (first offense only)"
                rows={3}
                className="panel rounded-lg px-3 py-2.5 outline-none text-sm text-ink placeholder:text-ink-faint"
              />
              <div className="flex gap-2">
                <button onClick={submitAppeal} className="btn-verdict flex-1 rounded-lg py-2.5 text-xs font-extrabold">
                  Submit appeal
                </button>
                <button onClick={() => setShowAppeal(false)} className="btn-ghost rounded-lg px-3 text-xs font-bold">
                  Cancel
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {showBrief && !(brief && brief.ai_verdict) && (
        <div className="flex flex-col gap-2 mt-1">
          {briefing ? (
            <div className="ai-line px-0.5">
              <div className="ai-orb pulse-alert" style={{ width: 14, height: 14 }} />
              <span>The Judge is weighing it...</span>
            </div>
          ) : (
            <>
              <textarea
                value={briefText}
                onChange={(e) => setBriefText(e.target.value)}
                placeholder="Explain what actually happened — real work the record doesn't show?"
                rows={3}
                className="panel rounded-lg px-3 py-2.5 outline-none text-sm text-ink placeholder:text-ink-faint"
              />
              <div className="flex gap-2">
                <button onClick={submitBrief} className="btn-verdict flex-1 rounded-lg py-2.5 text-xs font-extrabold">
                  Submit to Judge
                </button>
                <button onClick={() => setShowBrief(false)} className="btn-ghost rounded-lg px-3 text-xs font-bold">
                  Cancel
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {bid && bid.status !== "pending" && (
        <div className="panel rounded-lg px-3 py-2.5 flex flex-col gap-1">
          <div className="ai-line">
            <div className="ai-orb" />
            <span>The Judge, ruling</span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <p className="text-[12px] text-ink-dim leading-snug flex-1">{bid.ai_evaluation}</p>
            <span className="label text-[9px] px-2 py-1 rounded-full bg-surface-raised shrink-0">
              {BID_STATUS_LABEL[bid.status] ?? bid.status}
            </span>
          </div>
        </div>
      )}

      {appeal && appeal.ai_verdict && (
        <div className="panel rounded-lg px-3 py-2.5 flex flex-col gap-1">
          <div className="ai-line">
            <div className="ai-orb" />
            <span>The Judge, ruling</span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <p className="text-[12px] text-ink-dim leading-snug flex-1">{appeal.ai_reasoning}</p>
            <span className="label text-[9px] px-2 py-1 rounded-full bg-surface-raised shrink-0">
              {appeal.ai_verdict === "approved" ? "APPROVED" : "DENIED"}
            </span>
          </div>
        </div>
      )}

      {brief && brief.ai_verdict && (
        <div className="panel rounded-lg px-3 py-2.5 flex flex-col gap-1">
          <div className="ai-line">
            <div className="ai-orb" />
            <span>The Judge, ruling</span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <p className="text-[12px] text-ink-dim leading-snug flex-1">{brief.ai_reasoning}</p>
            <span className="label text-[9px] px-2 py-1 rounded-full bg-surface-raised shrink-0">
              {BRIEF_VERDICT_LABEL[brief.ai_verdict] ?? brief.ai_verdict}
            </span>
          </div>
        </div>
      )}

      {canPay && (
        <div className="mt-1">
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) uploadProof(file);
            }}
          />
          <button
            onClick={() => fileInput.current?.click()}
            disabled={uploading}
            className="btn-danger w-full rounded-lg py-2.5 text-xs font-extrabold disabled:opacity-50"
          >
            {uploading ? "Uploading..." : "Pay & upload proof"}
          </button>
        </div>
      )}

      {fine.status === "paid_pending_proof" && isMine && (
        <p className="text-[11px] text-ink-dim font-semibold mt-0.5">Proof submitted — waiting on partner approval.</p>
      )}

      {awaitingMyApproval && (
        <div className="flex flex-col gap-2 mt-1">
          {proof && (
            <p className="text-[11px] text-ink-faint">Proof uploaded {new Date(proof.uploaded_at).toLocaleString()}</p>
          )}
          <button
            onClick={approveProof}
            disabled={approving}
            className="btn-verdict rounded-lg py-2.5 text-xs font-extrabold disabled:opacity-50"
          >
            {approving ? "Approving..." : "Approve payment"}
          </button>
        </div>
      )}
    </div>
  );
}

function FinesSection() {
  const { appUser, partner } = useSession();
  const { data, reload } = useRealtimeQuery(["fines", "violations", "bids", "appeals", "payment_proofs", "fine_briefs"], fetchFines);

  const violationsById = useMemo(() => {
    const map = new Map<string, Violation>();
    for (const v of data?.violations ?? []) map.set(v.id, v);
    return map;
  }, [data]);

  const proofByFineId = useMemo(() => {
    const map = new Map<string, PaymentProof>();
    for (const p of data?.proofs ?? []) map.set(p.fine_id, p);
    return map;
  }, [data]);

  const briefByFineId = useMemo(() => {
    const map = new Map<string, FineBrief>();
    for (const b of data?.briefs ?? []) {
      const existing = map.get(b.fine_id);
      if (!existing || new Date(b.created_at) > new Date(existing.created_at)) map.set(b.fine_id, b);
    }
    return map;
  }, [data]);

  const bidByFineId = useMemo(() => {
    const map = new Map<string, Bid>();
    for (const b of data?.bids ?? []) {
      const existing = map.get(b.fine_id);
      if (!existing || new Date(b.created_at) > new Date(existing.created_at)) map.set(b.fine_id, b);
    }
    return map;
  }, [data]);

  const appealByFineId = useMemo(() => {
    const map = new Map<string, Appeal>();
    for (const a of data?.appeals ?? []) {
      const existing = map.get(a.fine_id);
      if (!existing || new Date(a.created_at) > new Date(existing.created_at)) map.set(a.fine_id, a);
    }
    return map;
  }, [data]);

  const usersById = useMemo(() => {
    const map = new Map<string, AppUser>();
    for (const u of data?.users ?? []) map.set(u.id, u);
    return map;
  }, [data]);

  const tasksById = useMemo(() => {
    const map = new Map<string, Task>();
    for (const t of data?.tasks ?? []) map.set(t.id, t);
    return map;
  }, [data]);

  function offenseCountBefore(v: Violation | undefined): number {
    if (!v) return 0;
    return (data?.violations ?? []).filter(
      (other) => other.user_id === v.user_id && other.type === v.type && other.detected_at < v.detected_at
    ).length;
  }

  const myFines = useMemo(() => (data?.fines ?? []).filter((f) => f.user_id === appUser?.id), [data, appUser]);
  const partnerFines = useMemo(() => (data?.fines ?? []).filter((f) => f.user_id === partner?.id), [data, partner]);

  const myOpen = myFines.filter((f) => f.status !== "paid_approved" && f.status !== "waived");
  const myClosed = myFines.filter((f) => f.status === "paid_approved" || f.status === "waived");
  const partnerAwaitingApproval = partnerFines.filter((f) => f.status === "paid_pending_proof");

  if (!data) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 py-12">
        <div className="w-9 h-9 rounded-full border-2 border-ink-faint/25 border-t-ink animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {partnerAwaitingApproval.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-[13px] font-bold text-amber uppercase tracking-[0.08em] px-1">Needs your approval</h2>
          {partnerAwaitingApproval.map((f) => (
            <FineCard
              key={f.id}
              fine={f}
              violation={violationsById.get(f.violation_id)}
              proof={proofByFineId.get(f.id)}
              brief={briefByFineId.get(f.id)}
              bid={bidByFineId.get(f.id)}
              appeal={appealByFineId.get(f.id)}
              isMine={false}
              priorOffenseCount={0}
              onReload={reload}
              finedUser={usersById.get(f.user_id)}
              relatedTask={violationsById.get(f.violation_id)?.task_id ? tasksById.get(violationsById.get(f.violation_id)!.task_id!) : undefined}
            />
          ))}
        </section>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-[13px] font-bold text-ink-dim uppercase tracking-[0.08em] px-1">Your fines</h2>
        {myOpen.length === 0 && (
          <div className="panel rounded-xl px-4 py-6 text-center">
            <p className="text-ink-dim text-sm font-medium">Clean record. Keep it that way.</p>
          </div>
        )}
        {myOpen.map((f) => (
          <FineCard
            key={f.id}
            fine={f}
            violation={violationsById.get(f.violation_id)}
            proof={proofByFineId.get(f.id)}
            brief={briefByFineId.get(f.id)}
            bid={bidByFineId.get(f.id)}
            appeal={appealByFineId.get(f.id)}
            isMine
            priorOffenseCount={offenseCountBefore(violationsById.get(f.violation_id))}
            onReload={reload}
            finedUser={usersById.get(f.user_id)}
            relatedTask={violationsById.get(f.violation_id)?.task_id ? tasksById.get(violationsById.get(f.violation_id)!.task_id!) : undefined}
          />
        ))}
      </section>

      {myClosed.length > 0 && (
        <section className="flex flex-col">
          <h2 className="text-[13px] font-bold text-ink-dim uppercase tracking-[0.08em] px-1 mb-1">Closed</h2>
          <div className="flex flex-col">
            {myClosed.map((f) => (
              <div key={f.id} className="list-row">
                <p className="text-[12.5px] text-ink-dim flex-1 min-w-0 truncate">
                  {violationsById.get(f.violation_id)?.type.replace(/_/g, " ")}
                </p>
                <p className="money text-sm font-bold text-ink-faint shrink-0">{formatNaira(f.amount)}</p>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

// ── Treasury ─────────────────────────────────────────────────────────────

interface TreasuryData {
  balance: number;
  projects: WarChestProject[];
  proposal: (WarChestProposal & { project: WarChestProject | null }) | null;
  pleas: WarChestPlea[];
}

async function fetchTreasury(): Promise<TreasuryData> {
  const res = await fetch("/api/treasury");
  const json = await res.json();
  return {
    balance: json.balance ?? 0,
    projects: json.projects ?? [],
    proposal: json.proposal ?? null,
    pleas: json.pleas ?? [],
  };
}

// Treasury balance is this screen's one dominant number, so it earns the
// hero-ring treatment (rule #1) — but only once there's an active project,
// since the ring's fill is a progress-toward-something signal and an empty
// ring around a bare balance would read as "0% of nothing," which is
// misleading. With no project, the balance drops to a quiet plain number
// instead — no box, no ring, no false progress metaphor.
function TreasuryRing({ balance, project, progressPct }: { balance: number; project: WarChestProject; progressPct: number }) {
  const size = 148;
  const r = 64;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(1, progressPct / 100));
  const dash = c * clamped;
  return (
    <div className="ring-hero">
      <div className="relative" style={{ width: size, height: size }}>
        <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-raised)" strokeWidth="9" />
          {clamped > 0 && (
            <circle
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke="var(--accent)"
              strokeWidth="9"
              strokeLinecap="round"
              strokeDasharray={`${dash} ${c}`}
            />
          )}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center px-4 text-center">
          <span className="stat-num text-[25px] leading-none money">{formatNaira(balance)}</span>
          <span className="label mt-1.5">Balance</span>
        </div>
      </div>
      <p className="stat-inline">
        <b>{progressPct}%</b> toward<span className="sep">·</span>
        <span className="text-ink font-bold">{project.name}</span>
      </p>
    </div>
  );
}

function TreasurySection() {
  const { data, reload } = useRealtimeQuery(
    ["fines", "war_chest_projects", "war_chest_proposals", "war_chest_pleas"],
    fetchTreasury
  );
  const [pleaText, setPleaText] = useState("");
  const [pleading, setPleading] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState("");

  async function submitPlea() {
    if (!pleaText.trim()) return;
    setPleading(true);
    setError("");
    await fetch("/api/treasury/plea", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason_text: pleaText.trim() }),
    });
    setPleading(false);
    setPleaText("");
    reload();
  }

  async function acceptProposal() {
    setAccepting(true);
    setError("");
    const res = await fetch("/api/treasury/accept", { method: "POST" });
    const json = await res.json();
    setAccepting(false);
    if (!res.ok) {
      setError(json.error ?? "Could not accept the proposal.");
      return;
    }
    reload();
  }

  if (!data) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 py-12">
        <div className="w-9 h-9 rounded-full border-2 border-ink-faint/25 border-t-ink animate-spin" />
      </div>
    );
  }

  const proposal = data.proposal;
  const project = proposal?.project ?? null;
  const fundedProjects = data.projects.filter((p) => p.status === "funded");
  const canAccept = project ? data.balance >= project.cost_naira : false;
  const progressPct = project && project.cost_naira > 0 ? Math.min(100, Math.round((data.balance / project.cost_naira) * 100)) : 0;

  return (
    <div className="flex flex-col gap-5">
      {project ? (
        <TreasuryRing balance={data.balance} project={project} progressPct={progressPct} />
      ) : (
        <div className="flex flex-col items-center gap-1">
          <span className="label">Balance</span>
          <span className="money stat-num text-[34px] leading-none">{formatNaira(data.balance)}</span>
        </div>
      )}

      {project && (
        <section className="panel-strong rounded-2xl p-5 flex flex-col gap-3">
          <div className="ai-line">
            <div className="ai-orb" />
            <span>The Board proposes</span>
          </div>
          <div>
            <p className="font-bold text-[16px]">{project.name}</p>
            <p className="money grad-text text-3xl font-extrabold mt-0.5">{formatNaira(project.cost_naira)}</p>
          </div>
          {proposal?.ai_reasoning && <p className="text-[12.5px] text-ink-dim leading-snug">{proposal.ai_reasoning}</p>}

          <button
            onClick={acceptProposal}
            disabled={!canAccept || accepting}
            className="btn-verdict rounded-xl py-3 font-extrabold disabled:opacity-40 active:scale-[0.98] transition-transform"
          >
            {accepting ? "Accepting..." : canAccept ? "Accept proposal" : "Balance not there yet"}
          </button>
          {error && <p className="text-red text-xs font-semibold">{error}</p>}

          <div className="flex flex-col gap-2 mt-1">
            <p className="label">Plead for a different priority</p>
            <textarea
              value={pleaText}
              onChange={(e) => setPleaText(e.target.value)}
              placeholder="Make the case for something else..."
              rows={3}
              className="panel rounded-xl px-4 py-3 outline-none focus:border-ink/30 transition placeholder:text-ink-faint text-ink text-sm"
            />
            <button
              onClick={submitPlea}
              disabled={pleading || !pleaText.trim()}
              className="btn-ghost rounded-xl py-2.5 text-sm font-bold disabled:opacity-50 active:scale-[0.98] transition-transform"
            >
              {pleading ? "Filing with the Board..." : "File plea"}
            </button>
          </div>

          {data.pleas.length > 0 && (
            <div className="flex flex-col mt-2">
              <p className="label mb-0.5">Plea history</p>
              {data.pleas.map((p) => (
                <div key={p.id} className="list-row items-start">
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] text-ink italic">&ldquo;{p.reason_text}&rdquo;</p>
                    {p.ai_response && <p className="text-[11.5px] text-ink-dim mt-1.5">{p.ai_response}</p>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {!project && (
        <div className="panel rounded-xl px-4 py-6 text-center">
          <p className="text-ink-dim text-sm font-medium">
            No active proposal right now. The Board proposes one automatically once the treasury has a balance.
          </p>
        </div>
      )}

      {fundedProjects.length > 0 && (
        <section className="flex flex-col">
          <h2 className="text-[13px] font-bold text-ink-dim uppercase tracking-[0.08em] px-1 mb-1">Funded so far</h2>
          <div className="flex flex-col">
            {fundedProjects.map((p) => (
              <div key={p.id} className="list-row">
                <div className="flex-1 min-w-0">
                  <p className="text-[13.5px] font-semibold">{p.name}</p>
                  <p className="money text-[12px] text-ink-faint mt-0.5">{formatNaira(p.cost_naira)}</p>
                </div>
                <span className="label text-[9px] px-2 py-1 rounded-full border border-verdict/50 text-verdict shrink-0">FUNDED</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

// ── Combined page ────────────────────────────────────────────────────────
// Personal stakes used to live in a third tab here — Jay was explicit that
// was wrong ("I'm even surprised why personal fines is in the same section
// with fines and treasury"). They now live at /personal/stakes, their own
// screen in the Personal globe (see src/app/personal/stakes/page.tsx).
// This ledger is Team-only: Fines + Treasury, nothing else.

type LedgerTab = "fines" | "treasury";

export default function LedgerPage() {
  const [tab, setTab] = useState<LedgerTab>("fines");

  const headline = tab === "fines" ? "Fines don't forgive themselves." : "Fines fund something real.";

  return (
    <div className="flex-1 flex flex-col">
      <div className="flex-1 flex flex-col px-5 pt-[calc(1.4rem+env(safe-area-inset-top))] pb-28 gap-5 max-w-md w-full mx-auto">
        <header className="rise rise-1 flex items-center justify-between gap-3">
          <div>
            <p className="label mb-1">The ledger</p>
            <h1 className="display-hero text-2xl">{headline}</h1>
          </div>
        </header>

        <div className="rise rise-2 segpill-group self-start">
          <button className={`segpill ${tab === "fines" ? "active" : ""}`} onClick={() => setTab("fines")}>
            Fines
          </button>
          <button className={`segpill ${tab === "treasury" ? "active" : ""}`} onClick={() => setTab("treasury")}>
            Treasury
          </button>
        </div>

        <div className="rise rise-3">
          {tab === "fines" && <FinesSection />}
          {tab === "treasury" && <TreasurySection />}
        </div>
      </div>
      <BottomNav />
    </div>
  );
}
