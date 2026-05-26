import { headers } from "next/headers";
import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { transactions, categories } from "@/lib/db/schema";
import { Card } from "@/components/ui/card";
import { SpendDonut } from "@/components/spend-donut";
import { EmptyState } from "@/components/empty-state";
import { TransactionsTable } from "@/components/transactions-table";

export default async function DashboardPage() {
  const session = (await auth.api.getSession({ headers: await headers() }))!;
  const userId = session.user.id;

  const start = new Date();
  start.setDate(start.getDate() - 30);
  const startIso = start.toISOString().slice(0, 10);

  const spendRows = await db
    .select({
      categoryId: transactions.categoryId,
      total: sql<string>`sum(${transactions.amount})`,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, userId),
        gte(transactions.postedAt, startIso),
        lt(transactions.amount, "0"),
      ),
    )
    .groupBy(transactions.categoryId);

  const cats = await db.select().from(categories).where(eq(categories.userId, userId));
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

  const recent = await db
    .select()
    .from(transactions)
    .where(eq(transactions.userId, userId))
    .orderBy(desc(transactions.postedAt))
    .limit(10);

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
            <h2 className="mb-2 text-lg font-medium">Last 30 days · spend by category</h2>
            <SpendDonut data={donut} />
          </Card>

          <Card className="p-4">
            <h2 className="mb-2 text-lg font-medium">Recent transactions</h2>
            <TransactionsTable rows={recent} categories={cats} />
          </Card>
        </>
      )}
    </div>
  );
}
