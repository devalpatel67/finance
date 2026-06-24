import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { eq, desc, asc } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { scopedDb } from "@/lib/db/scoped";
import { financialAccounts, statements, transactions, categories } from "@/lib/db/schema";
import { TransactionsTable } from "@/components/transactions-table";

export default async function AccountDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = (await auth.api.getSession({ headers: await headers() }))!;
  const sdb = scopedDb(session.user.id);

  const [a] = await sdb.selectAll(financialAccounts, { where: eq(financialAccounts.id, id), limit: 1 });
  if (!a) notFound();

  const stmts = await sdb.selectAll(statements, {
    where: eq(statements.financialAccountId, a.id),
    orderBy: desc(statements.uploadedAt),
  });

  const txns = await sdb.selectAll(transactions, {
    where: eq(transactions.financialAccountId, a.id),
    orderBy: asc(transactions.postedAt),
  });

  const cats = await sdb.selectAll(categories);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">{a.name}</h1>
        <p className="text-muted-foreground">
          {a.kind}{a.institution ? ` · ${a.institution}` : ""}{a.last4 ? ` · …${a.last4}` : ""} · {a.currency}
        </p>
      </header>

      <section>
        <h2 className="mb-2 text-lg font-medium">Statements</h2>
        {stmts.length === 0 ? (
          <p className="text-sm text-muted-foreground">No statements yet.</p>
        ) : (
          <ul className="divide-y rounded border">
            {stmts.map((s) => (
              <li key={s.id} className="flex items-center justify-between p-3">
                <Link href={`/statements/${s.id}`} className="hover:underline">{s.sourceFilename}</Link>
                <span className="text-xs text-muted-foreground">{s.extractionStatus}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-lg font-medium">Transactions</h2>
        <TransactionsTable rows={txns} categories={cats} />
      </section>
    </div>
  );
}
