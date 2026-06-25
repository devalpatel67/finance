import { formatCurrency } from "@/lib/format/currency";
import type { RankedCategory } from "@/lib/dashboard/rank";

export function CategoryRanking({ items, currency }: { items: RankedCategory[]; currency: string }) {
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">No spend in this range.</p>;
  }
  const top = items.slice(0, 8);
  const max = Math.max(1, ...top.map((i) => i.amount));
  return (
    <div className="flex flex-col gap-3.5">
      {top.map((c) => (
        <div key={c.name} className="grid grid-cols-[110px_1fr_auto] items-center gap-3">
          <div className="flex items-center gap-2 text-sm">
            <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: c.color }} />
            <span className="truncate">{c.name}</span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full" style={{ width: `${(c.amount / max) * 100}%`, background: c.color }} />
          </div>
          <div className="text-right font-mono text-[13px] tabular-nums">
            {formatCurrency(String(c.amount), currency)}
            {c.deltaPct != null && (
              <span className={`ml-2 text-[11px] ${c.deltaPct > 0 ? "text-[#9a4b2e]" : c.deltaPct < 0 ? "text-positive" : "text-muted-foreground"}`}>
                {c.deltaPct > 0 ? "▲" : c.deltaPct < 0 ? "▼" : "·"}{Math.abs(c.deltaPct)}%
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
