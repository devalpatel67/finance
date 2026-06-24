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
import { getSpendByCategory } from "@/lib/queries/dashboard";
import { stitchAccountsIntoRows } from "@/lib/transactions/stitch-accounts";
import { formatRangeLabel, parseRange } from "@/lib/dates/ranges";

type Search = { range?: string; from?: string; to?: string };

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
  const spendRows = await getSpendByCategory(userId, range.fromIso, range.toIso);

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

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Dashboard</h1>

      {recent.length === 0 ? (
        <EmptyState
          title="No transactions yet"
          description="Upload your first statement to see your spending breakdown."
        />
      ) : (
        <>
          <Card className="p-4">
            <div className="mb-2 flex items-start justify-between gap-4">
              <h2 className="text-lg font-medium">
                Spend by category — {formatRangeLabel(range)}
              </h2>
              <TimeRangePicker />
            </div>
            {donut.length === 0 ? (
              <p className="text-sm text-muted-foreground">No spend in this range.</p>
            ) : (
              <SpendDonut data={donut} />
            )}
          </Card>

          <Card className="p-4">
            <h2 className="mb-2 text-lg font-medium">Recent transactions</h2>
            <TransactionsTable rows={stitchAccountsIntoRows(recent, accts)} categories={cats} showAccount />
          </Card>
        </>
      )}
    </div>
  );
}
