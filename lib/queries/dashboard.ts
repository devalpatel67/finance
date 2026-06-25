import { and, eq, gte, lte, sql, SQL } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { scopeFilter } from "@/lib/db/scoped";
import { transactions } from "@/lib/db/schema";

export type SpendByCategoryRow = {
  categoryId: string | null;
  total: string;
};

/**
 * Sums transaction spend grouped by category for the given user, restricted
 * to outflow rows. `fromIso` / `toIso` (each YYYY-MM-DD or null) bound the
 * postedAt window; null means unbounded on that side. Inflows (refunds) and
 * transfers (e.g. credit-card payments) are excluded so they don't pollute
 * the spend-by-category breakdown.
 *
 * Sums the magnitude (`abs`) of each amount: outflows are inconsistently
 * signed across statements (bank withdrawals negative, many credit-card
 * charges positive), so summing the signed net would let opposite-signed
 * rows cancel — making totals wrong and non-monotonic as the range widens.
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
      total: sql<string>`sum(abs(${transactions.amount}))`,
    })
    .from(transactions)
    .where(and(...filters))
    .groupBy(transactions.categoryId);
}

/**
 * Total inflow (sum of magnitudes) for the user within the optional postedAt
 * window. Mirrors getSpendByCategory's outflow handling.
 */
export async function getInflowTotal(
  userId: string,
  fromIso: string | null,
  toIso: string | null,
): Promise<number> {
  const filters: SQL[] = [
    scopeFilter(transactions, userId),
    eq(transactions.direction, "inflow"),
  ];
  if (fromIso) filters.push(gte(transactions.postedAt, fromIso));
  if (toIso) filters.push(lte(transactions.postedAt, toIso));

  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(abs(${transactions.amount})), 0)` })
    .from(transactions)
    .where(and(...filters));
  return Number(row?.total ?? 0);
}
