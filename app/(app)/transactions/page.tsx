import { headers } from "next/headers";
import { and, desc, eq, gte, ilike, lte, SQL } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { transactions, categories, financialAccounts } from "@/lib/db/schema";
import { TransactionsTable } from "@/components/transactions-table";
import { stitchAccountsIntoRows } from "@/lib/transactions/stitch-accounts";

type Search = { account?: string; category?: string; q?: string; from?: string; to?: string };

export default async function TransactionsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const session = (await auth.api.getSession({ headers: await headers() }))!;

  const filters: SQL[] = [eq(transactions.userId, session.user.id)];
  if (sp.account)  filters.push(eq(transactions.financialAccountId, sp.account));
  if (sp.category) filters.push(eq(transactions.categoryId, sp.category));
  if (sp.q)        filters.push(ilike(transactions.description, `%${sp.q}%`));
  if (sp.from)     filters.push(gte(transactions.postedAt, sp.from));
  if (sp.to)       filters.push(lte(transactions.postedAt, sp.to));

  const [rows, cats, accts] = await Promise.all([
    db.select().from(transactions).where(and(...filters)).orderBy(desc(transactions.postedAt)).limit(500),
    db.select().from(categories).where(eq(categories.userId, session.user.id)),
    db.select().from(financialAccounts).where(eq(financialAccounts.userId, session.user.id)),
  ]);

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Transactions</h1>
      </header>

      <form className="flex flex-wrap items-end gap-2 text-sm" method="get">
        <label className="grid gap-1">
          <span className="text-muted-foreground">Account</span>
          <select name="account" defaultValue={sp.account ?? ""} className="rounded border px-2 py-1">
            <option value="">All</option>
            {accts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
        <label className="grid gap-1">
          <span className="text-muted-foreground">Category</span>
          <select name="category" defaultValue={sp.category ?? ""} className="rounded border px-2 py-1">
            <option value="">All</option>
            {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label className="grid gap-1">
          <span className="text-muted-foreground">From</span>
          <input type="date" name="from" defaultValue={sp.from ?? ""} className="rounded border px-2 py-1" />
        </label>
        <label className="grid gap-1">
          <span className="text-muted-foreground">To</span>
          <input type="date" name="to" defaultValue={sp.to ?? ""} className="rounded border px-2 py-1" />
        </label>
        <label className="grid gap-1 flex-1">
          <span className="text-muted-foreground">Search</span>
          <input name="q" defaultValue={sp.q ?? ""} placeholder="Description contains…" className="rounded border px-2 py-1" />
        </label>
        <button className="rounded border bg-secondary px-3 py-1" type="submit">Apply</button>
      </form>

      <TransactionsTable rows={stitchAccountsIntoRows(rows, accts)} categories={cats} showAccount />
    </div>
  );
}
