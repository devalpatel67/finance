import { formatCurrency } from "@/lib/format/currency";
import type { HeatGrid } from "@/lib/dashboard/heatmap";

const LEVELS = ["#efefe8", "#cfe0d3", "#8fbb9f", "#3e8c63", "#15663f"];

export function SpendHeatmap({ grid, currency }: { grid: HeatGrid; currency: string }) {
  const labelByCol = new Map(grid.monthLabels.map((l) => [l.col, l.label]));
  return (
    <div className="overflow-x-auto pb-1">
      <div className="inline-block">
        <div className="mb-1.5 flex gap-[3px] text-[10px] text-muted-foreground">
          {grid.weeks.map((_, i) => (
            <span key={i} className="w-[13px] shrink-0 whitespace-nowrap">{labelByCol.get(i) ?? ""}</span>
          ))}
        </div>
        <div className="flex gap-[3px]">
          {grid.weeks.map((week, i) => (
            <div key={i} className="flex flex-col gap-[3px]">
              {week.map((c, j) => (
                <div
                  key={j}
                  className="size-[13px] rounded-[3px]"
                  style={{ background: LEVELS[c.level] }}
                  title={c.date ? `${c.date}: ${formatCurrency(String(c.total), currency)}` : undefined}
                />
              ))}
            </div>
          ))}
        </div>
        <div className="mt-2.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          Less
          {LEVELS.map((bg) => (
            <span key={bg} className="size-[13px] rounded-[3px]" style={{ background: bg }} />
          ))}
          More
        </div>
      </div>
    </div>
  );
}
