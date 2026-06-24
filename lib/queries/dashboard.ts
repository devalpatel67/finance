import { and, eq, gte, lte, sql, SQL } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { scopeFilter } from "@/lib/db/scoped";
import { transactions } from "@/lib/db/schema";

export type SpendByCategoryRow = {
  categoryId: string | null;
  total: string;
};

/**
 * Sums transaction amounts grouped by category for the given user, restricted
 * to outflow rows. `fromIso` / `toIso` (each YYYY-MM-DD or null) bound the
 * postedAt window; null means unbounded on that side. Inflows (refunds) and
 * transfers (e.g. credit-card payments) are excluded so they don't pollute
 * the spend-by-category breakdown.
 */
export async function getSpendByCategory(
  userId: string,
  fromIso: string | null,
  toIso: string | null,
): Promise<SpendByCategoryRow[]> {
  const filters: SQL[] = [
    scopeFilter(transactions, userId),
    eq(transactions.direction, "outflow"),
  ];
  if (fromIso) filters.push(gte(transactions.postedAt, fromIso));
  if (toIso) filters.push(lte(transactions.postedAt, toIso));

  return db
    .select({
      categoryId: transactions.categoryId,
      total: sql<string>`sum(${transactions.amount})`,
    })
    .from(transactions)
    .where(and(...filters))
    .groupBy(transactions.categoryId);
}
