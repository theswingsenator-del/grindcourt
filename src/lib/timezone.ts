// Per-user IANA timezone helpers. Every server-side "what day/hour is it
// for this person" computation must go through here — never raw
// Date/UTC math (that was the bug: the whole violation-detection system
// used one server-UTC clock for both partners, so whichever one wasn't
// aligned with UTC got the wrong calendar day / wrong hour). See
// supabase/migrations/0006_timezones.sql for the app_users.timezone column.

/**
 * Returns YYYY-MM-DD for the given instant, as a calendar date in the
 * given IANA timezone. en-CA formats as YYYY-MM-DD directly, so this
 * never relies on slicing a UTC ISO string (that's the bug this replaces).
 */
export function localDateString(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/**
 * Returns the hour (0-23) for the given instant, in the given timezone.
 */
export function localHour(date: Date, timezone: string): number {
  const formatted = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    hour12: false,
  }).format(date);
  const hour = parseInt(formatted, 10);
  // Some ICU implementations render local midnight as "24" with hour12:
  // false — normalize to 0.
  return hour === 24 ? 0 : hour;
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * Returns the day of week (0=Sunday..6=Saturday) for the given instant, in
 * the given timezone.
 */
export function localDayOfWeek(date: Date, timezone: string): number {
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "long",
  }).format(date);
  const idx = WEEKDAYS.indexOf(weekday);
  return idx === -1 ? date.getDay() : idx;
}
