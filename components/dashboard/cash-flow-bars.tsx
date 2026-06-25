import { formatCurrency } from "@/lib/format/currency";
import { monthShort } from "@/lib/format/date";
import type { MonthlyCashFlow } from "@/lib/queries/dashboard";

export function CashFlowBars({ months, currency }: { months: MonthlyCashFlow[]; currency: string }) {
  if (months.length === 0) {
    return <p className="text-sm text-muted-foreground">No activity in this range.</p>;
  }
  const max = Math.max(1, ...months.flatMap((m) => [m.inflow, m.outflow]));
  return (
    <div className="flex h-44 items-end gap-3 pt-2">
      {months.map((m) => {
        const net = m.inflow - m.outflow;
        return (
          <div key={m.month} className="flex h-full flex-1 flex-col items-center justify-end gap-2">
            <div
              className="flex h-full w-full items-end justify-center gap-1"
              title={`${monthShort(m.month)} · in ${formatCurrency(String(m.inflow), currency)} · out ${formatCurrency(String(m.outflow), currency)}`}
            >
              <div className="w-3.5 rounded-t bg-positive" style={{ height: `${(m.inflow / max) * 100}%` }} />
              <div className="w-3.5 rounded-t bg-foreground/80" style={{ height: `${(m.outflow / max) * 100}%` }} />
            </div>
            <div className="text-center text-[11px] text-muted-foreground">
              {monthShort(m.month)}
              <div className={`font-mono text-[11px] tabular-nums ${net >= 0 ? "text-positive" : "text-foreground"}`}>
                {net >= 0 ? "+" : "−"}{Math.abs(net / 1000).toFixed(1)}k
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
