import { eq } from "drizzle-orm";
import { db } from "./client";
import * as schema from "./schema";

type ScopedTables =
  | typeof schema.financialAccounts
  | typeof schema.statements
  | typeof schema.transactions
  | typeof schema.categories
  | typeof schema.budgets;

export function scopeFilter<T extends ScopedTables>(table: T, userId: string) {
  return eq((table as any).userId, userId);
}

export function scopedDb(userId: string) {
  return { db, userId, scope: <T extends ScopedTables>(t: T) => scopeFilter(t, userId) };
}

export type ScopedDb = ReturnType<typeof scopedDb>;
