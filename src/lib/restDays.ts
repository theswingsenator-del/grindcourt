// Rest-day earn rule: +1 rest day per 5 tasks completed.
// "Unbudgeted rest" = spent balance exceeds earned balance at any point.

export const TASKS_PER_REST_DAY = 5;

export function restDaysEarnedFromCompletedCount(completedTaskCount: number): number {
  return Math.floor(completedTaskCount / TASKS_PER_REST_DAY);
}

export interface RestDayLedgerRow {
  kind: "earned" | "spent";
  delta: number;
}

export function restDayBalance(rows: RestDayLedgerRow[]): number {
  return rows.reduce((sum, r) => sum + (r.kind === "earned" ? r.delta : -Math.abs(r.delta)), 0);
}

export function isUnbudgeted(rows: RestDayLedgerRow[]): boolean {
  return restDayBalance(rows) < 0;
}
