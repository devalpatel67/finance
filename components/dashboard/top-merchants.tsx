import { formatCurrency } from "@/lib/format/currency";
import type { MerchantTotal } from "@/lib/queries/dashboard";

export function TopMerchants({ merchants, currency }: { merchants: MerchantTotal[]; currency: string }) {
  if (merchants.length === 0) {
    return <p className="text-sm text-muted-foreground">No merchants in this range.</p>;
  }
  return (
    <div className="flex flex-col">
      {merchants.map((m, i) => (
        <div key={m.merchant} className="flex items-center gap-3 border-t border-border py-2.5 first:border-t-0">
          <span className="w-4 font-mono text-xs text-muted-foreground">{i + 1}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{m.merchant}</span>
            <span className="text-[11px] text-muted-foreground">{m.count} {m.count === 1 ? "txn" : "txns"}</span>
          </span>
          <span className="font-mono text-[13px] tabular-nums">{formatCurrency(String(m.total), currency)}</span>
        </div>
      ))}
    </div>
  );
}
