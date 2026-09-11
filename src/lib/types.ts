// Shared domain types — mirror the Postgres schema in supabase/migrations/0001_init.sql.

export type PartnerSlot = "partner_a" | "partner_b";

export interface AppUser {
  id: string;
  display_name: string;
  slot: PartnerSlot;
  created_at: string;
  timezone: string;
  enforcement_start_at: string | null;
}

export interface Goal {
  id: string;
  created_at: string;
  owner_id: string;
  title: string;
  description: string | null;
  target_date: string | null;
  visibility: "partner" | "personal";
}

export type TaskStatus = "pending" | "done" | "overdue";

export type TaskVisibility = "partner" | "personal";

export interface Task {
  id: string;
  created_at: string;
  goal_id: string | null;
  owner_id: string;
  title: string;
  description: string | null;
  due_at: string | null;
  status: TaskStatus;
  completed_at: string | null;
  is_disputed: boolean;
  disputed_by: string | null;
  dispute_resolved: boolean;
  needs_help: boolean;
  source: "manual" | "ai_suggested";
  approval_status: "approved" | "pending";
  blocked_by_task_id: string | null;
  visibility: TaskVisibility;
}

export interface DailyLog {
  id: string;
  created_at: string;
  owner_id: string;
  log_date: string;
  morning_commit_done: boolean;
  morning_commit_text: string | null;
  morning_commit_at: string | null;
  night_report_done: boolean;
  night_report_text: string | null;
  night_report_at: string | null;
}

export type RestDayKind = "earned" | "spent";

export interface RestDay {
  id: string;
  created_at: string;
  owner_id: string;
  kind: RestDayKind;
  delta: number;
  reason: string;
  related_task_id: string | null;
}

export type ViolationType =
  | "missed_log"
  | "task_overdue"
  | "false_complete"
  | "late_night_activity"
  | "unbudgeted_rest"
  | "repeat_excuse"
  | "ignored_nags"
  | "late_completion";

export type ViolationSeverity = "low" | "standard" | "high";

export interface Violation {
  id: string;
  created_at: string;
  type: ViolationType;
  user_id: string;
  task_id: string | null;
  detected_at: string;
  severity: ViolationSeverity;
  streak_count_at_time: number;
  details: string | null;
  appeal_forfeited: boolean;
}

export type FineStatus =
  | "issued"
  | "bid_pending"
  | "accepted"
  | "appealed"
  | "paid_pending_proof"
  | "paid_approved"
  | "appeal_denied"
  | "waived";

export interface Fine {
  id: string;
  created_at: string;
  violation_id: string;
  user_id: string;
  amount: number;
  rung: number;
  status: FineStatus;
}

export type BidStatus = "pending" | "accepted" | "rejected" | "countered";

export interface Bid {
  id: string;
  created_at: string;
  fine_id: string;
  proposed_amount: number;
  reason_text: string;
  submitted_by: string;
  ai_evaluation: string | null;
  status: BidStatus;
  counter_amount: number | null;
}

export interface Appeal {
  id: string;
  created_at: string;
  fine_id: string;
  reason_text: string;
  ai_verdict: "approved" | "denied" | null;
  ai_reasoning: string | null;
  decided_at: string | null;
}

export interface PaymentProof {
  id: string;
  fine_id: string;
  uploaded_by: string;
  image_url: string;
  uploaded_at: string;
  approved_by_partner: boolean;
  approved_at: string | null;
}

export interface AppNotification {
  id: string;
  created_at: string;
  user_id: string;
  type: string;
  title: string;
  body: string;
  read: boolean;
  related_fine_id: string | null;
  related_task_id: string | null;
  push_sent_count: number;
  push_pruned_count: number;
}

// ── War Chest (treasury) ────────────────────────────────────────────────

export type WarChestProjectStatus = "seeded" | "proposed" | "funded";
export type WarChestProjectSource = "seeded" | "ai_suggested";

export interface WarChestProject {
  id: string;
  created_at: string;
  name: string;
  cost_naira: number;
  status: WarChestProjectStatus;
  source: WarChestProjectSource;
}

export type WarChestProposalStatus = "active" | "accepted" | "superseded";

export interface WarChestProposal {
  id: string;
  created_at: string;
  project_id: string;
  ai_reasoning: string | null;
  status: WarChestProposalStatus;
}

export interface WarChestPlea {
  id: string;
  created_at: string;
  proposal_id: string;
  submitted_by: string;
  reason_text: string;
  ai_response: string | null;
}

// ── Collaborative work orders ───────────────────────────────────────────

export type TaskCollaboratorStatus = "requested" | "approved";

export interface TaskCollaborator {
  id: string;
  created_at: string;
  task_id: string;
  user_id: string;
  status: TaskCollaboratorStatus;
}

export interface TaskNote {
  id: string;
  created_at: string;
  task_id: string;
  user_id: string;
  body: string;
}

// ── Predictor ────────────────────────────────────────────────────────────

export interface PredictorNudge {
  id: string;
  created_at: string;
  user_id: string;
  day_of_week: number;
  message: string;
  acknowledged: boolean;
  resulted_in_violation_id: string | null;
}

// ── Auditor ──────────────────────────────────────────────────────────────

export interface AuditorBaseline {
  user_id: string;
  avg_title_length: number;
  sample_size: number;
  updated_at: string;
}

export interface AuditorFlag {
  id: string;
  created_at: string;
  user_id: string;
  task_id: string | null;
  note: string | null;
}

// ── Narrator ─────────────────────────────────────────────────────────────

export interface FoundersUpdate {
  id: string;
  created_at: string;
  week_start: string;
  body: string;
}

// ── Outcome Check-ins ────────────────────────────────────────────────────

export type CheckinAssessment = "on_track" | "short" | "unclear";

export interface TaskCheckin {
  id: string;
  created_at: string;
  task_id: string;
  user_id: string;
  prompted_at: string;
  response_text: string | null;
  responded_at: string | null;
  ai_assessment: CheckinAssessment | null;
  follow_up_created: boolean;
}

// ── Brief the Judge ──────────────────────────────────────────────────────

export type BriefVerdict = "waive" | "update_task" | "insist";

export interface FineBrief {
  id: string;
  created_at: string;
  fine_id: string;
  submitted_by: string;
  brief_text: string;
  ai_verdict: BriefVerdict | null;
  ai_reasoning: string | null;
  decided_at: string | null;
}

// ── Board Conduct (settings) ────────────────────────────────────────────

export type NagTone = "blunt" | "roast" | "formal";

export interface ConductSettings {
  user_id: string;
  nag_tone: NagTone;
  predictor_enabled: boolean;
  updated_at: string;
}

// ── Extension requests ("Request more time") ────────────────────────────

export interface TaskExtensionRequest {
  id: string;
  created_at: string;
  task_id: string;
  requested_by: string;
  reason_text: string;
  original_due_at: string;
  requested_due_at: string;
  ai_verdict: "granted" | "denied" | null;
  ai_reasoning: string | null;
  decided_at: string | null;
}

// ── Talk to the Judge (conversational task editor) ──────────────────────

export type JudgeChatRole = "user" | "assistant";

export type JudgeChatActionType = "reassign_task" | "edit_task" | "create_task" | "hold_task";

export interface JudgeChatAction {
  type: JudgeChatActionType;
  task_id?: string;
  new_owner_id?: string;
  title?: string;
  due_at?: string | null;
  goal_id?: string | null;
  owner_id?: string;
  approval_status?: "pending" | "approved";
  blocked_by_task_id?: string | null;
}

export interface JudgeChatMessage {
  id: string;
  created_at: string;
  user_id: string;
  role: JudgeChatRole;
  content: string;
  action_json: JudgeChatAction | null;
}

// ── $3K sprint earnings ──────────────────────────────────────────────────

export interface EarningsLogEntry {
  id: string;
  created_at: string;
  user_id: string;
  task_id: string | null;
  amount_usd: number;
  note: string | null;
  logged_at: string;
}

export interface SprintGoal {
  id: string;
  created_at: string;
  target_usd: number;
  label: string;
  starts_at: string;
  ends_at: string;
}

// ── Personal Mode ────────────────────────────────────────────────────────
// A self-imposed stake on a PERSONAL (visibility='personal') task — no
// partner involvement, no AI Judge, no dispute mechanism. The owner marks
// it paid or waives it themselves, honor system. Think of it as a private
// commitment-device ledger entry, not a real fine.

export type PersonalStakeStatus = "active" | "paid" | "waived";

export interface PersonalStake {
  id: string;
  created_at: string;
  task_id: string;
  owner_id: string;
  amount: number;
  status: PersonalStakeStatus;
  paid_at: string | null;
}
