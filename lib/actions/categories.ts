"use server";

import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { categories } from "@/lib/db/schema";

async function requireUser() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Not signed in");
  return session.user.id;
}

const Upsert = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1).max(60),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
});

export async function saveCategory(input: { id?: string; name: string; color: string }) {
  const userId = await requireUser();
  const parsed = Upsert.parse(input);
  if (parsed.id) {
    await db.update(categories).set({ name: parsed.name, color: parsed.color })
      .where(and(eq(categories.id, parsed.id), eq(categories.userId, userId)));
  } else {
    await db.insert(categories).values({ userId, name: parsed.name, color: parsed.color, isSystem: false });
  }
  revalidatePath("/categories");
}

export async function deleteCategory(id: string) {
  const userId = await requireUser();
  const [row] = await db.select().from(categories)
    .where(and(eq(categories.id, id), eq(categories.userId, userId))).limit(1);
  if (!row) throw new Error("Category not found");
  if (row.isSystem) throw new Error("Cannot delete system categories");
  await db.delete(categories).where(eq(categories.id, id));
  revalidatePath("/categories");
}
