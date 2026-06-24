"use server";

import { and, eq, inArray, ne } from "drizzle-orm";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { categories, categoryRules, transactions } from "@/lib/db/schema";
import { normalizeDescription } from "@/lib/categories/normalize";

const CreateInput = z.object({
  keyword: z.string().min(1),
  categoryId: z.string().uuid(),
});

export async function createCategoryRule(input: { keyword: string; categoryId: string }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Not signed in");
  const userId = session.user.id;
  const parsed = CreateInput.parse(input);

  const keyword = normalizeDescription(parsed.keyword);
  if (!keyword) throw new Error("Keyword is empty after normalization");

  // category must belong to the user
  const [cat] = await db
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.id, parsed.categoryId), eq(categories.userId, userId)))
    .limit(1);
  if (!cat) throw new Error("Category not found");

  await db
    .insert(categoryRules)
    .values({ userId, keyword, categoryId: parsed.categoryId })
    .onConflictDoUpdate({
      target: [categoryRules.userId, categoryRules.keyword],
      set: { categoryId: parsed.categoryId },
    });

  // Backfill matching transactions that aren't manually categorized.
  const candidates = await db
    .select({ id: transactions.id, description: transactions.description })
    .from(transactions)
    .where(and(eq(transactions.userId, userId), ne(transactions.categorySource, "manual")));
  const ids = candidates
    .filter((t) => normalizeDescription(t.description).includes(keyword))
    .map((t) => t.id);
  if (ids.length > 0) {
    await db
      .update(transactions)
      .set({ categoryId: parsed.categoryId, categorySource: "rule" })
      .where(and(eq(transactions.userId, userId), inArray(transactions.id, ids)));
  }

  revalidatePath("/transactions");
  revalidatePath("/rules");
}

export async function deleteCategoryRule(ruleId: string) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Not signed in");
  const id = z.string().uuid().parse(ruleId);
  await db
    .delete(categoryRules)
    .where(and(eq(categoryRules.id, id), eq(categoryRules.userId, session.user.id)));
  revalidatePath("/rules");
}
