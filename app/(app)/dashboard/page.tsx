import { headers } from "next/headers";
import { desc } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { scopedDb } from "@/lib/db/scoped";
import { transactions, categories, financialAccounts } from "@/lib/db/schema";
import { Card } from "@/components/ui/card";
import { SpendDonut } from "@/components/spend-donut";
import { EmptyState } from "@/components/empty-state";
import { TransactionsTable } from "@/components/transactions-table";
import { TimeRangePicker } from "@/components/time-range-picker";
import { getSpendByCategory, getInflowTotal } from "@/lib/queries/dashboard";
import { stitchAccountsIntoRows } from "@/lib/transactions/stitch-accounts";
import { formatRangeLabel, parseRange } from "@/lib/dates/ranges";
import { formatCurrency } from "@/lib/format/currency";

type Search = { range?: string; from?: string; to?: string };

function Tile({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: React.ReactNode;
}) {
  return (
    <Card className="p-5">
      <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <div className="mt-2.5">{children}</div>
      {hint && <p className="mt-1.5 text-xs text-muted-foreground">{hint}</p>}
    </Card>
  );
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const sp = await searchParams;
  const session = (await auth.api.getSession({ headers: await headers() }))!;
  const userId = session.user.id;

  const sdb = scopedDb(userId);
  const range = parseRange(sp);
  const [spendRows, inflow] = await Promise.all([
    getSpendByCategory(userId, range.fromIso, range.toIso),
    getInflowTotal(userId, range.fromIso, range.toIso),
  ]);

  const cats = await sdb.selectAll(categories);
  const catById = new Map(cats.map((c) => [c.id, c]));

  const donut = spendRows
    .map((r) => {
      const c = r.categoryId ? catById.get(r.categoryId) : null;
      return {
        name: c?.name ?? "Uncategorized",
        color: c?.color ?? "#9ca3af",
        value: Math.abs(Number(r.total)),
      };
    })
    .sort((a, b) => b.value - a.value);

  const recent = await sdb.selectAll(transactions, {
    orderBy: desc(transactions.postedAt),
    limit: 10,
  });
  const accts = await sdb.selectAll(financialAccounts);
  const currency = accts[0]?.currency ?? "USD";

  const spent = donut.reduce((sum, d) => sum + d.value, 0);
  const top = donut[0];
  const topPct = spent > 0 && top ? Math.round((top.value / spent) * 100) : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <TimeRangePicker />
      </div>

      {recent.length === 0 ? (
        <EmptyState
          title="No transactions yet"
          description="Upload your first statement to see your spending breakdown."
        />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <Tile label={`Spent · ${formatRangeLabel(range)}`} hint={`across ${accts.length} account${accts.length === 1 ? "" : "s"}`}>
              <span className="tabular text-2xl font-medium">{formatCurrency(String(spent), currency)}</span>
            </Tile>
            <Tile label="Received" hint="deposits, refunds & transfers in">
              <span className="tabular text-2xl font-medium text-positive">+{formatCurrency(String(inflow), currency)}</span>
            </Tile>
            <Tile
              label="Top category"
              hint={top ? <><span className="tabular">{formatCurrency(String(top.value), currency)}</span> · {topPct}% of spend</> : "—"}
            >
              <span className="font-serif text-2xl font-semibold">{top?.name ?? "—"}</span>
            </Tile>
          </div>

          <Card className="p-5">
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Spend by category · {formatRangeLabel(range)}
            </p>
            {donut.length === 0 ? (
              <p className="mt-4 text-sm text-muted-foreground">No spend in this range.</p>
            ) : (
              <div className="mt-4">
                <SpendDonut data={donut} />
              </div>
            )}
          </Card>

          <Card className="p-5">
            <p className="mb-4 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Recent transactions
            </p>
            <TransactionsTable rows={stitchAccountsIntoRows(recent, accts)} categories={cats} showAccount />
          </Card>
        </>
      )}
    </div>
  );
}
