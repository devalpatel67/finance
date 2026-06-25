import type { SpendByCategoryRow } from "@/lib/queries/dashboard";

export type RankedCategory = {
  name: string;
  color: string;
  amount: number;
  deltaPct: number | null;
};

/**
 * Ranks categories by current-period spend (descending) and computes the
 * percent change vs the prior period. `deltaPct` is null when there's no
 * comparable prior spend (or no prior period was supplied).
 */
export function rankCategories({
  current,
  prior,
  categories,
}: {
  current: SpendByCategoryRow[];
  prior: SpendByCategoryRow[] | null;
  categories: { id: string; name: string; color: string }[];
}): RankedCategory[] {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const priorById = new Map((prior ?? []).map((r) => [r.categoryId ?? "—", Math.abs(Number(r.total))]));

  return current
    .map((r) => {
      const cat = r.categoryId ? byId.get(r.categoryId) : null;
      const amount = Math.abs(Number(r.total));
      const priorAmt = prior ? priorById.get(r.categoryId ?? "—") ?? 0 : null;
      const deltaPct =
        priorAmt && priorAmt > 0 ? Math.round(((amount - priorAmt) / priorAmt) * 100) : null;
      return {
        name: cat?.name ?? "Uncategorized",
        color: cat?.color ?? "#9c968a",
        amount,
        deltaPct,
      };
    })
    .sort((a, b) => b.amount - a.amount);
}
