export type HeatLevel = 0 | 1 | 2 | 3 | 4;
export type HeatCell = { date: string | null; total: number; level: HeatLevel };
export type HeatGrid = {
  weeks: HeatCell[][];
  monthLabels: { col: number; label: string }[];
  max: number;
};

const DAY = 86_400_000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const toMs = (iso: string): number => {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};
const toIso = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const weekday = (ms: number): number => new Date(ms).getUTCDay(); // 0=Sun

function levelFor(total: number, max: number): HeatLevel {
  if (total <= 0 || max <= 0) return 0;
  const r = total / max;
  if (r <= 0.25) return 1;
  if (r <= 0.5) return 2;
  if (r <= 0.75) return 3;
  return 4;
}

/**
 * Builds a GitHub-style heatmap: columns are weeks (Sun→Sat top→bottom), one
 * cell per day, for the `days`-day window ending at `endIso`. Cells outside the
 * window are padding (date=null, level 0). Levels are quartiles of the window's
 * max daily outflow. All date math is UTC so it's deterministic.
 */
export function buildYearHeatmap(
  daily: { date: string; total: number }[],
  endIso: string,
  days = 364,
): HeatGrid {
  const totals = new Map(daily.map((d) => [d.date, d.total]));
  const max = daily.reduce((m, d) => Math.max(m, d.total), 0);

  const end = toMs(endIso);
  const start = end - days * DAY;
  const gridStart = start - weekday(start) * DAY; // back up to Sunday

  const weeks: HeatCell[][] = [];
  const monthLabels: { col: number; label: string }[] = [];
  let col: HeatCell[] = [];
  let lastMonth = -1;

  for (let d = gridStart; d <= end; d += DAY) {
    const inRange = d >= start && d <= end;
    const iso = toIso(d);
    const total = inRange ? totals.get(iso) ?? 0 : 0;
    col.push({ date: inRange ? iso : null, total, level: inRange ? levelFor(total, max) : 0 });
    if (col.length === 7) {
      const top = col.find((c) => c.date);
      if (top) {
        const month = new Date(toMs(top.date!)).getUTCMonth();
        if (month !== lastMonth) {
          monthLabels.push({ col: weeks.length, label: MONTHS[month] });
          lastMonth = month;
        }
      }
      weeks.push(col);
      col = [];
    }
  }
  if (col.length) {
    while (col.length < 7) col.push({ date: null, total: 0, level: 0 });
    weeks.push(col);
  }
  return { weeks, monthLabels, max };
}
