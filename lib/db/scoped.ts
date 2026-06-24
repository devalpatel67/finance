import { and, eq, type InferSelectModel, type SQL } from "drizzle-orm";
import { db } from "./client";
import * as schema from "./schema";

type ScopedTable =
  | typeof schema.financialAccounts
  | typeof schema.statements
  | typeof schema.transactions
  | typeof schema.categories
  | typeof schema.budgets;

export function scopeFilter<T extends ScopedTable>(table: T, userId: string): SQL {
  return eq(table.userId, userId);
}

function withScope<T extends ScopedTable>(table: T, userId: string, extra?: SQL): SQL {
  const scope = scopeFilter(table, userId);
  return extra ? and(scope, extra)! : scope;
}

type SelectOpts = { where?: SQL; orderBy?: SQL | SQL[]; limit?: number };

/**
 * The sanctioned entry point for reading per-user business data from pages.
 * Every read AND-s the caller's userId into the WHERE clause, so a query can
 * never reach across tenants even if an explicit `where` says otherwise.
 * `app/**` is barred from the raw db client by ESLint; queries needing custom
 * projections live in `lib/queries` and use `scopeFilter` directly.
 */
export function scopedDb(userId: string) {
  return {
    userId,

    async selectAll<T extends ScopedTable>(
      table: T,
      opts: SelectOpts = {},
    ): Promise<InferSelectModel<T>[]> {
      // The cast is internal only: the public signature stays fully typed via
      // InferSelectModel. `.from()` rejects a generic table param, and
      // `$dynamic()` gives a uniform builder we can conditionally extend.
      let q = db
        .select()
        .from(table as never)
        .where(withScope(table, userId, opts.where))
        .$dynamic();
      if (opts.orderBy) {
        q = q.orderBy(...(Array.isArray(opts.orderBy) ? opts.orderBy : [opts.orderBy]));
      }
      if (opts.limit != null) q = q.limit(opts.limit);
      return q as unknown as InferSelectModel<T>[];
    },
  };
}

export type ScopedDb = ReturnType<typeof scopedDb>;
