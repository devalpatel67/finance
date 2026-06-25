// Pinned locale + UTC so server and client render identical text, and the
// weekday matches the stored calendar date exactly (a "YYYY-MM-DD" is a date,
// not an instant — formatting in local time could shift it a day).
const WEEKDAY_FMT = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" });

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Short weekday ("Mon".."Sun") for a YYYY-MM-DD date string. "" if malformed. */
export function weekdayShort(iso: string): string {
  if (!ISO_DATE.test(iso)) return "";
  return WEEKDAY_FMT.format(new Date(`${iso}T00:00:00Z`));
}
