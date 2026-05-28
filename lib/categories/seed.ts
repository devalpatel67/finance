import { db } from "@/lib/db/client";
import { categories } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";

const SYSTEM_CATEGORIES: Array<{ name: string; color: string }> = [
  { name: "Groceries", color: "#10b981" },
  { name: "Dining", color: "#f97316" },
  { name: "Transport", color: "#0ea5e9" },
  { name: "Utilities", color: "#a855f7" },
  { name: "Bills", color: "#ef4444" },
  { name: "Subscriptions", color: "#ec4899" },
  { name: "Shopping", color: "#f59e0b" },
  { name: "Entertainment", color: "#8b5cf6" },
  { name: "Health", color: "#22c55e" },
  { name: "Travel", color: "#3b82f6" },
  { name: "Income", color: "#16a34a" },
  { name: "Transfers", color: "#64748b" },
  { name: "Fees", color: "#dc2626" },
  { name: "Other", color: "#94a3b8" },
  { name: "Uncategorized", color: "#9ca3af" },
];

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
