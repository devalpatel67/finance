import { normalizeDescription } from "./normalize";

export type CategoryRef = { id: string; name: string };
export type CategorySource = "suggested" | "rule" | "manual";
export type RuleRef = { keyword: string; categoryId: string };

export function pickCategoryId(cats: CategoryRef[], suggested: string): string | null {
  const lower = suggested.trim().toLowerCase();
  const hit = cats.find((c) => c.name.toLowerCase() === lower);
  if (hit) return hit.id;
  const fallback = cats.find((c) => c.name.toLowerCase() === "uncategorized");
  return fallback?.id ?? null;
}

/**
 * Resolves a category by precedence: a matching rule (longest keyword wins;
 * callers pass rules newest-first so ties pick the newest) beats the LLM's
 * suggested label, which beats Uncategorized. Never returns source "manual".
 */
export function resolveCategory(input: {
  description: string;
  suggestedLabel: string;
  rules: RuleRef[];
  categories: CategoryRef[];
}): { categoryId: string | null; source: CategorySource } {
  const norm = normalizeDescription(input.description);
  const matched = input.rules
    .filter((r) => r.keyword.length > 0 && norm.includes(r.keyword))
    .sort((a, b) => b.keyword.length - a.keyword.length); // stable: ties keep input (newest-first) order
  if (matched.length > 0) {
    return { categoryId: matched[0].categoryId, source: "rule" };
  }

  const lower = input.suggestedLabel.trim().toLowerCase();
  const hit = input.categories.find((c) => c.name.toLowerCase() === lower);
  if (hit) return { categoryId: hit.id, source: "suggested" };

  const fallback = input.categories.find((c) => c.name.toLowerCase() === "uncategorized");
  return { categoryId: fallback?.id ?? null, source: "suggested" };
}
