// Friendly short label for a user's IANA timezone, for the "your day
// resets at 12:00 AM {label}" copy on the dashboard/settings. Only the two
// timezones actually in use (see supabase/migrations/0006_timezones.sql)
// are mapped by name; anything else falls back to a generic label derived
// from the IANA string rather than trying to solve this generally.
const KNOWN_LABELS: Record<string, string> = {
  "Africa/Lagos": "Lagos time",
  "America/Indiana/Indianapolis": "Indianapolis time",
};

export function friendlyTimezoneLabel(timezone: string): string {
  if (KNOWN_LABELS[timezone]) return KNOWN_LABELS[timezone];
  const city = timezone.split("/").pop()?.replace(/_/g, " ") ?? timezone;
  return `${city} time`;
}
