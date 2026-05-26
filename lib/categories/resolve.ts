export type CategoryRef = { id: string; name: string };

export function pickCategoryId(cats: CategoryRef[], suggested: string): string | null {
  const lower = suggested.trim().toLowerCase();
  const hit = cats.find((c) => c.name.toLowerCase() === lower);
  if (hit) return hit.id;
  const fallback = cats.find((c) => c.name.toLowerCase() === "uncategorized");
  return fallback?.id ?? null;
}
