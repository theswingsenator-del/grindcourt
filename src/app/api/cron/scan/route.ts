import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabaseServer";
import {
  detectOverdueTasks,
  detectLateNightActivity,
  detectUnbudgetedRest,
  detectRepeatExcuse,
  detectIgnoredNags,
  isEnforcementLive,
  NewViolation,
} from "@/lib/violations";
import { issueFine } from "@/lib/issueFine";
import { policeNag } from "@/lib/police";
import { notify } from "@/lib/notify";
import { AppUser, Bid, Appeal, NagTone } from "@/lib/types";
import { proposeNextInitiative, getTreasuryBalance } from "@/lib/treasury";
import { maybeSendNudge } from "@/lib/predictor";
import { generateWeeklyUpdate } from "@/lib/narrator";

// The Police's heartbeat. Call this on a schedule (Vercel Cron, or any
// external cron hitting this URL with the CRON_SECRET bearer token — see
// README for both options). Each run:
//   1. Scans for new violations (overdue tasks, missed logs, late-night
//      patterns, unbudgeted rest, repeat excuses, ignored nags).
//   2. Issues a fine on the ladder for each newly-detected violation.
//   3. Sends an escalating nag for every fine that is NOT paid_approved
//      (and not appeal_denied-and-closed) — this is the only loop that
//      stops when a fine reaches paid_approved.
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const db = createSupabaseAdminClient();
  if (!db) return NextResponse.json({ ok: false, error: "db_not_configured" }, { status: 503 });

  const now = new Date();

  // War Chest proposals are funding, not punishment — they run every scan
  // regardless of the enforcement grace period below.
  let treasuryProposalId: string | null = null;
  const balanceForProposal = await getTreasuryBalance(db);
  if (balanceForProposal > 0) {
    const proposal = await proposeNextInitiative(db);
    treasuryProposalId = proposal?.id ?? null;
  }

  // Enforcement launch is now PER-USER (app_users.enforcement_start_at),
  // not a single global grace period — see supabase/migrations/0007_extensions_and_tiers.sql.
  // Jason and Samuel are launching the judicial system at their own local
  // midnight, which are different UTC instants. Each detector below gates
  // itself per-user via lib/violations.ts isEnforcementLive() rather than
  // this route returning early for everyone.
  const lateNightCutoffHour = Number(process.env.LATE_NIGHT_CUTOFF_HOUR ?? 23);

  const [
    { data: users },
    { data: tasks },
    { data: dailyLogs },
    { data: restDays },
    { data: violations },
    { data: fines },
    { data: bids },
    { data: appeals },
  ] = await Promise.all([
    db.from("app_users").select("*"),
    db.from("tasks").select("*"),
    db.from("daily_logs").select("*"),
    db.from("rest_days").select("*"),
    db.from("violations").select("*"),
    db.from("fines").select("*"),
    db.from("bids").select("*"),
    db.from("appeals").select("*"),
  ]);

  const usersList = (users ?? []) as AppUser[];
  const tasksList = tasks ?? [];
  const dailyLogsList = dailyLogs ?? [];
  const restDaysList = restDays ?? [];
  const violationsList = violations ?? [];
  const finesList = fines ?? [];
  const bidsList = (bids ?? []) as Bid[];
  const appealsList = (appeals ?? []) as Appeal[];

  const detectionInput = {
    users: usersList,
    tasks: tasksList,
    dailyLogs: dailyLogsList,
    restDays: restDaysList,
    violations: violationsList,
    fines: finesList,
    now,
    lateNightCutoffHour,
  };

  const reasonTextsByUser = new Map<string, string[]>();
  for (const bid of bidsList) {
    const arr = reasonTextsByUser.get(bid.submitted_by) ?? [];
    arr.push(bid.reason_text);
    reasonTextsByUser.set(bid.submitted_by, arr);
  }
  for (const appeal of appealsList) {
    const fine = finesList.find((f) => f.id === appeal.fine_id);
    if (!fine) continue;
    const arr = reasonTextsByUser.get(fine.user_id) ?? [];
    arr.push(appeal.reason_text);
    reasonTextsByUser.set(fine.user_id, arr);
  }

  function fineHasResponse(fineId: string): boolean {
    if (bidsList.some((b) => b.fine_id === fineId)) return true;
    if (appealsList.some((a) => a.fine_id === fineId)) return true;
    return false;
  }

  const newViolations: NewViolation[] = [
    ...detectOverdueTasks(detectionInput),
    ...detectLateNightActivity(detectionInput),
    ...detectUnbudgetedRest(detectionInput),
    ...detectRepeatExcuse(usersList, reasonTextsByUser, violationsList, now),
    ...detectIgnoredNags(finesList, fineHasResponse, violationsList, now, usersList),
  ];

  const issued: Array<{ type: string; user_id: string; fine_amount: number }> = [];
  for (const nv of newViolations) {
    const result = await issueFine(nv.user_id, nv.type, nv.task_id, nv.details);
    if (result) issued.push({ type: nv.type, user_id: nv.user_id, fine_amount: result.fine.amount });
  }

  // Board Conduct settings per user — drives the Police's nag tone.
  const { data: conductRows } = await db.from("conduct_settings").select("*");
  const toneByUser = new Map<string, NagTone>();
  const predictorEnabledByUser = new Map<string, boolean>();
  for (const row of conductRows ?? []) {
    toneByUser.set(row.user_id, row.nag_tone as NagTone);
    predictorEnabledByUser.set(row.user_id, row.predictor_enabled);
  }

  // Nag every fine that isn't closed out. Re-fetch fines since new ones
  // were just issued above. "accepted" is an appeal-approved fine (amount
  // forced to 0) — also closed out, never nags.
  const { data: openFinesRaw } = await db
    .from("fines")
    .select("*")
    .not("status", "in", "(paid_approved,appeal_denied,waived,accepted)");
  const openFines = openFinesRaw ?? [];

  // Cron runs every ~10 minutes but a nag should escalate over real hours,
  // not spam a fresh notification every single scan — that flooded the
  // Inbox with thousands of "Pay Up" rows. One nag per fine per cooldown.
  const NAG_COOLDOWN_MS = 4 * 60 * 60 * 1000;
  let nagsSent = 0;
  for (const fine of openFines) {
    const { data: lastNag } = await db
      .from("notifications")
      .select("created_at")
      .eq("type", "police_nag")
      .eq("related_fine_id", fine.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (lastNag && now.getTime() - new Date(lastNag.created_at).getTime() < NAG_COOLDOWN_MS) continue;

    const { data: violation } = await db.from("violations").select("*").eq("id", fine.violation_id).single();
    if (!violation) continue;
    const ageMs = now.getTime() - new Date(fine.created_at).getTime();
    const daysUnresolved = Math.max(0, Math.floor(ageMs / (1000 * 60 * 60 * 24)));
    const tone = toneByUser.get(fine.user_id) ?? "blunt";
    const nag = await policeNag(violation, fine, daysUnresolved, tone);
    await notify({
      userId: fine.user_id,
      type: "police_nag",
      title: nag.title,
      body: nag.body,
      relatedFineId: fine.id,
    });
    nagsSent += 1;
  }

  // Predictor — pre-emptive nudges, part of enforcement so gated by the
  // same grace period as violation detection (we're past that gate here).
  let nudgesSent = 0;
  for (const user of usersList) {
    if (predictorEnabledByUser.get(user.id) === false) continue;
    const sent = await maybeSendNudge(db, user.id, user.timezone, now);
    if (sent) nudgesSent += 1;
  }

  // Narrator — weekly Founders' Update. Fires on Sunday, or if the most
  // recent update is more than 7 days old (whichever is more robust to a
  // missed cron run).
  let founderUpdateCreated = false;
  const { data: latestUpdate } = await db
    .from("founders_updates")
    .select("*")
    .order("week_start", { ascending: false })
    .limit(1)
    .maybeSingle();
  const daysSinceLastUpdate = latestUpdate
    ? (now.getTime() - new Date(latestUpdate.week_start).getTime()) / (1000 * 60 * 60 * 24)
    : Infinity;
  const isSunday = now.getDay() === 0;
  if (!latestUpdate || isSunday || daysSinceLastUpdate > 7) {
    const weekStart = now.toISOString().slice(0, 10);
    const { data: existingForWeek } = await db
      .from("founders_updates")
      .select("id")
      .eq("week_start", weekStart)
      .maybeSingle();
    if (!existingForWeek) {
      const body = await generateWeeklyUpdate(db, now);
      await db.from("founders_updates").insert({ week_start: weekStart, body });
      founderUpdateCreated = true;
      for (const user of usersList) {
        await notify({
          userId: user.id,
          type: "founders_update",
          title: "This week's Founders' Update is ready",
          body: "The Narrator wrote up this week — open the Updates page to read it.",
        });
      }
    }
  }

  return NextResponse.json({
    ok: true,
    scanned_at: now.toISOString(),
    enforcement: usersList.map((u) => ({
      user_id: u.id,
      enforcement_start_at: u.enforcement_start_at,
      live: isEnforcementLive(u, now),
    })),
    violations_created: issued.length,
    issued,
    nags_sent: nagsSent,
    treasury_proposal_id: treasuryProposalId,
    nudges_sent: nudgesSent,
    founders_update_created: founderUpdateCreated,
  });
}
