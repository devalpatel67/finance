import { formatCurrency } from "@/lib/format/currency";
import type { HeatGrid } from "@/lib/dashboard/heatmap";

const LEVELS = ["#efefe8", "#cfe0d3", "#8fbb9f", "#3e8c63", "#15663f"];

export function SpendHeatmap({ grid, currency }: { grid: HeatGrid; currency: string }) {
  const labelByCol = new Map(grid.monthLabels.map((l) => [l.col, l.label]));
  return (
    <div>
      <div className="mb-1.5 flex w-full gap-[3px] text-[10px] text-muted-foreground">
        {grid.weeks.map((_, i) => (
          <span key={i} className="flex-1 overflow-visible whitespace-nowrap">{labelByCol.get(i) ?? ""}</span>
        ))}
      </div>
      <div className="flex w-full gap-[3px]">
        {grid.weeks.map((week, i) => (
          <div key={i} className="flex flex-1 flex-col gap-[3px]">
            {week.map((c, j) => (
              <div
                key={j}
                className="aspect-square w-full rounded-[3px]"
                style={{ background: LEVELS[c.level] }}
                title={c.date ? `${c.date}: ${formatCurrency(String(c.total), currency)}` : undefined}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-1.5 text-[11px] text-muted-foreground">
        Less
        {LEVELS.map((bg) => (
          <span key={bg} className="size-[13px] rounded-[3px]" style={{ background: bg }} />
        ))}
        More
      </div>
    </div>
  );
}
