export type RangePreset =
  | "30d"
  | "90d"
  | "6m"
  | "1y"
  | "2y"
  | "5y"
  | "all"
  | "custom";

export type Range = {
  preset: RangePreset;
  fromIso: string | null;
  toIso: string | null;
};

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const PRESETS: ReadonlySet<RangePreset> = new Set([
  "30d",
  "90d",
  "6m",
  "1y",
  "2y",
  "5y",
  "all",
  "custom",
]);

function toIsoUtc(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function validIsoDate(s: string | undefined): string | null {
  if (!s) return null;
  if (!ISO_DATE_RE.test(s)) return null;
  // Reject things like "2026-13-40" that pass the regex but aren't real dates.
  const parsed = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  if (toIsoUtc(parsed) !== s) return null;
  return s;
}

function subtractDays(today: Date, n: number): string {
  const d = new Date(today);
  d.setUTCDate(d.getUTCDate() - n);
  return toIsoUtc(d);
}

function subtractMonths(today: Date, n: number): string {
  const d = new Date(today);
  d.setUTCMonth(d.getUTCMonth() - n);
  return toIsoUtc(d);
}

function subtractYears(today: Date, n: number): string {
  const d = new Date(today);
  d.setUTCFullYear(d.getUTCFullYear() - n);
  return toIsoUtc(d);
}

export function parseRange(
  searchParams: { range?: string; from?: string; to?: string },
  today: Date = new Date(),
): Range {
  const raw = searchParams.range;
  const preset: RangePreset =
    raw && PRESETS.has(raw as RangePreset) ? (raw as RangePreset) : "30d";

  switch (preset) {
    case "30d":
      return { preset, fromIso: subtractDays(today, 30), toIso: null };
    case "90d":
      return { preset, fromIso: subtractDays(today, 90), toIso: null };
    case "6m":
      return { preset, fromIso: subtractMonths(today, 6), toIso: null };
    case "1y":
      return { preset, fromIso: subtractYears(today, 1), toIso: null };
    case "2y":
      return { preset, fromIso: subtractYears(today, 2), toIso: null };
    case "5y":
      return { preset, fromIso: subtractYears(today, 5), toIso: null };
    case "all":
      return { preset, fromIso: null, toIso: null };
    case "custom":
      return {
        preset,
        fromIso: validIsoDate(searchParams.from),
        toIso: validIsoDate(searchParams.to),
      };
  }
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function formatIso(iso: string, includeYear: boolean): string {
  const [y, m, d] = iso.split("-").map(Number);
  const base = `${MONTHS[m - 1]} ${d}`;
  return includeYear ? `${base}, ${y}` : base;
}

function formatCustom(fromIso: string | null, toIso: string | null): string {
  if (!fromIso && !toIso) return "Custom range";
  if (fromIso && !toIso) return `Since ${formatIso(fromIso, true)}`;
  if (!fromIso && toIso) return `Through ${formatIso(toIso, true)}`;
  // Both present
  const fromYear = fromIso!.slice(0, 4);
  const toYear = toIso!.slice(0, 4);
  if (fromYear === toYear) {
    return `${formatIso(fromIso!, false)} – ${formatIso(toIso!, true)}`;
  }
  return `${formatIso(fromIso!, true)} – ${formatIso(toIso!, true)}`;
}

export function formatRangeLabel(range: Range): string {
  switch (range.preset) {
    case "30d":
      return "Last 30 days";
    case "90d":
      return "Last 90 days";
    case "6m":
      return "Last 6 months";
    case "1y":
      return "Last 1 year";
    case "2y":
      return "Last 2 years";
    case "5y":
      return "Last 5 years";
    case "all":
      return "All time";
    case "custom":
      return formatCustom(range.fromIso, range.toIso);
  }
}
