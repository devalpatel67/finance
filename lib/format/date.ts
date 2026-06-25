// Pinned locale + UTC so server and client render identical text, and the
// weekday matches the stored calendar date exactly (a "YYYY-MM-DD" is a date,
// not an instant — formatting in local time could shift it a day).
const WEEKDAY_FMT = new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "UTC" });

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Full weekday ("Monday".."Sunday") for a YYYY-MM-DD date string. "" if malformed. */
export function weekdayLong(iso: string): string {
  if (!ISO_DATE.test(iso)) return "";
  return WEEKDAY_FMT.format(new Date(`${iso}T00:00:00Z`));
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Short month for a "YYYY-MM" string. "" if malformed. */
export function monthShort(ym: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(ym);
  if (!m) return "";
  const idx = Number(m[2]) - 1;
  return MONTHS[idx] ?? "";
}
