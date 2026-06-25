import { and, count, eq, gte, isNotNull, lte, sql, SQL } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { scopeFilter } from "@/lib/db/scoped";
import { transactions } from "@/lib/db/schema";
import { normalizeMerchant } from "@/lib/transactions/merchant";

function rangeFilters(
  userId: string,
  fromIso: string | null,
  toIso: string | null,
  excludeCategoryId?: string,
): SQL[] {
  const filters: SQL[] = [scopeFilter(transactions, userId)];
  if (fromIso) filters.push(gte(transactions.postedAt, fromIso));
  if (toIso) filters.push(lte(transactions.postedAt, toIso));
  // Internal transfers aren't income or spending — exclude that category from
  // all analysis. `is distinct from` keeps uncategorized (null) rows.
  if (excludeCategoryId) filters.push(sql`${transactions.categoryId} is distinct from ${excludeCategoryId}`);
  return filters;
}

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
  excludeCategoryId?: string,
): Promise<SpendByCategoryRow[]> {
  return db
    .select({
      categoryId: transactions.categoryId,
      total: sql<string>`sum(abs(${transactions.amount}))`,
    })
    .from(transactions)
    .where(and(...rangeFilters(userId, fromIso, toIso, excludeCategoryId), eq(transactions.direction, "outflow")))
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
  excludeCategoryId?: string,
): Promise<number> {
  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(abs(${transactions.amount})), 0)` })
    .from(transactions)
    .where(and(...rangeFilters(userId, fromIso, toIso, excludeCategoryId), eq(transactions.direction, "inflow")));
  return Number(row?.total ?? 0);
}

export type MonthlyCashFlow = { month: string; inflow: number; outflow: number };

/** Money in vs out per calendar month (transfers excluded — internal moves). */
export async function getMonthlyCashFlow(
  userId: string,
  fromIso: string | null,
  toIso: string | null,
  excludeCategoryId?: string,
): Promise<MonthlyCashFlow[]> {
  const month = sql<string>`to_char(${transactions.postedAt}, 'YYYY-MM')`;
  const rows = await db
    .select({
      month,
      inflow: sql<string>`coalesce(sum(case when ${transactions.direction} = 'inflow' then abs(${transactions.amount}) else 0 end), 0)`,
      outflow: sql<string>`coalesce(sum(case when ${transactions.direction} = 'outflow' then abs(${transactions.amount}) else 0 end), 0)`,
    })
    .from(transactions)
    .where(and(...rangeFilters(userId, fromIso, toIso, excludeCategoryId)))
    .groupBy(month)
    .orderBy(month);
  return rows.map((r) => ({ month: r.month, inflow: Number(r.inflow), outflow: Number(r.outflow) }));
}

export type MerchantTotal = { merchant: string; total: number; count: number };

/**
 * Biggest merchants by outflow spend. Raw merchant strings are grouped by a
 * normalized key so near-duplicates ("Payment Pad" / "Payment Pad Inc") merge;
 * the highest-spend variant becomes the display name.
 */
export async function getTopMerchants(
  userId: string,
  fromIso: string | null,
  toIso: string | null,
  limit = 6,
  excludeCategoryId?: string,
): Promise<MerchantTotal[]> {
  const rows = await db
    .select({
      merchant: transactions.merchant,
      total: sql<string>`sum(abs(${transactions.amount}))`,
      count: count(),
    })
    .from(transactions)
    .where(and(
      ...rangeFilters(userId, fromIso, toIso, excludeCategoryId),
      eq(transactions.direction, "outflow"),
      isNotNull(transactions.merchant),
    ))
    .groupBy(transactions.merchant);

  const groups = new Map<string, { display: string; displayTotal: number; total: number; count: number }>();
  for (const r of rows) {
    if (r.merchant == null) continue;
    const total = Number(r.total);
    const cnt = Number(r.count);
    const key = normalizeMerchant(r.merchant) || r.merchant.toLowerCase();
    const g = groups.get(key) ?? { display: r.merchant, displayTotal: -1, total: 0, count: 0 };
    g.total += total;
    g.count += cnt;
    if (total > g.displayTotal || (total === g.displayTotal && r.merchant.length < g.display.length)) {
      g.display = r.merchant;
      g.displayTotal = total;
    }
    groups.set(key, g);
  }

  return [...groups.values()]
    .map((g) => ({ merchant: g.display, total: g.total, count: g.count }))
    .sort((a, b) => b.total - a.total)
    .slice(0, limit);
}

export type DailySpend = { date: string; total: number };

/** Daily outflow totals (for the spending heatmap). */
export async function getDailySpend(
  userId: string,
  fromIso: string | null,
  toIso: string | null,
  excludeCategoryId?: string,
): Promise<DailySpend[]> {
  const rows = await db
    .select({
      date: transactions.postedAt,
      total: sql<string>`sum(abs(${transactions.amount}))`,
    })
    .from(transactions)
    .where(and(...rangeFilters(userId, fromIso, toIso, excludeCategoryId), eq(transactions.direction, "outflow")))
    .groupBy(transactions.postedAt);
  return rows.map((r) => ({ date: r.date, total: Number(r.total) }));
}
