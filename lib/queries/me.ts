import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";

/** Reads the current user's row. `users` is a Better Auth table keyed by `id`, so it lives outside scopedDb. */
export async function getMe(userId: string) {
  const [me] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  return me;
}
