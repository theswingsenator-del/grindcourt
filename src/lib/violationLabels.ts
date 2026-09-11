// Human-readable copy for violation types + severities — used by the
// Ledger's "why was I fined" explainer (feature 7). Keeps the raw enum
// values out of user-facing text.
import { ViolationType, ViolationSeverity } from "./types";

const VIOLATION_LABELS: Record<ViolationType, string> = {
  missed_log: "You missed a daily check-in.",
  task_overdue: "A task passed its deadline still undone.",
  false_complete: "A completed task was disputed and the dispute was upheld.",
  late_night_activity: "A pattern of late-night activity was detected.",
  unbudgeted_rest: "You took more rest than you'd earned.",
  repeat_excuse: "The same excuse was used more than once.",
  ignored_nags: "A fine sat unanswered too long.",
  late_completion: "A task was finished late, on the same day it was due.",
};

export function violationLabel(type: ViolationType): string {
  return VIOLATION_LABELS[type] ?? type.replace(/_/g, " ");
}

const SEVERITY_LABELS: Record<ViolationSeverity, string> = {
  low: "Low",
  standard: "Standard",
  high: "High",
};

export function severityLabel(severity: ViolationSeverity): string {
  return SEVERITY_LABELS[severity] ?? severity;
}
