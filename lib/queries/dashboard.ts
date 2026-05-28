import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { transactions } from "@/lib/db/schema";

export type SpendByCategoryRow = {
  categoryId: string | null;
  total: string;
};

/**
 * Sums transaction amounts grouped by category for the given user, restricted
 * to outflow rows on or after `fromIso` (YYYY-MM-DD). Inflows (refunds) and
 * transfers (e.g. credit-card payments) are excluded so they don't pollute
 * the spend-by-category breakdown.
 */
export async function getSpendByCategory(
  userId: string,
  fromIso: string,
): Promise<SpendByCategoryRow[]> {
  return db
    .select({
      categoryId: transactions.categoryId,
      total: sql<string>`sum(${transactions.amount})`,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, userId),
        gte(transactions.postedAt, fromIso),
        eq(transactions.direction, "outflow"),
      ),
    )
    .groupBy(transactions.categoryId);
}
