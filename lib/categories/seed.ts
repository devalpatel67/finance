import { db } from "@/lib/db/client";
import { categories } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { SYSTEM_CATEGORY_COLORS } from "@/lib/categories/palette";

const SYSTEM_CATEGORIES: Array<{ name: string; color: string }> = Object.entries(
  SYSTEM_CATEGORY_COLORS,
).map(([name, color]) => ({ name, color }));

export async function seedDefaultCategoriesIfMissing(userId: string) {
  const existing = await db
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.userId, userId), eq(categories.isSystem, true)))
    .limit(1);
  if (existing.length > 0) return;

  await db.insert(categories).values(
    SYSTEM_CATEGORIES.map((c) => ({
      userId,
      name: c.name,
      color: c.color,
      isSystem: true,
    })),
  );
}
