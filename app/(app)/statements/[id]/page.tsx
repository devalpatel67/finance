import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { headers } from "next/headers";

import { auth } from "@/lib/auth";
import { scopedDb } from "@/lib/db/scoped";
import {
  categories,
  financialAccounts,
  statements,
  transactions,
} from "@/lib/db/schema";
import { presignedStatementUrl } from "@/lib/storage/minio";
import { formatCurrency } from "@/lib/format/currency";
import { Badge } from "@/components/ui/badge";
import { TransactionsTable } from "@/components/transactions-table";

import { ReprocessControls } from "./reprocess-controls";

export default async function StatementDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ duplicate?: string }>;
}) {
  const { id } = await params;
  const { duplicate } = await searchParams;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) notFound();
  const sdb = scopedDb(session.user.id);

  const [s] = await sdb.selectAll(statements, { where: eq(statements.id, id), limit: 1 });
  if (!s) notFound();

  const [acc] = await sdb.selectAll(financialAccounts, {
    where: eq(financialAccounts.id, s.financialAccountId),
    limit: 1,
  });

  const rows = await sdb.selectAll(transactions, {
    where: eq(transactions.statementId, s.id),
    orderBy: asc(transactions.postedAt),
  });

  const cats = await sdb.selectAll(categories);

  const pdfUrl = s.storageKey
    ? await presignedStatementUrl({ bucket: s.storageBucket, key: s.storageKey })
    : null;

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{s.sourceFilename}</h1>
          <p className="text-muted-foreground">
            {acc?.name}
            {s.periodStart && s.periodEnd ? ` · ${s.periodStart} – ${s.periodEnd}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Badge
            variant={
              s.extractionStatus === "succeeded"
                ? "default"
                : s.extractionStatus === "failed"
                  ? "destructive"
                  : "secondary"
            }
          >
            {s.extractionStatus}
          </Badge>
          {pdfUrl && (
            <a
              className="text-sm underline"
              href={pdfUrl}
              target="_blank"
              rel="noreferrer"
            >
              Download PDF
            </a>
          )}
          <ReprocessControls statementId={s.id} currentModel={s.modelUsed ?? ""} />
        </div>
      </header>

      {duplicate && (
        <p className="rounded border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          You already uploaded this statement, so we opened the existing one
          instead of importing it again. To re-extract it with a different model,
          use Reprocess above.
        </p>
      )}

      {s.reconciliationStatus === "discrepancy" && s.closingBalance && s.reconciliationDelta && (
        <p className="rounded border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          This statement may be incomplete. Expected closing balance{" "}
          {formatCurrency(
            Number(s.closingBalance) - Number(s.reconciliationDelta),
            acc?.currency ?? "USD",
          )}
          , but the statement shows {formatCurrency(s.closingBalance, acc?.currency ?? "USD")} (off by{" "}
          {formatCurrency(s.reconciliationDelta, acc?.currency ?? "USD")}).
        </p>
      )}
      {s.reconciliationStatus === "reconciled" && (
        <p className="rounded border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm">
          Balanced ✓ — transactions tie out to the statement balances.
        </p>
      )}
      {s.reconciliationStatus === "not_available" && (
        <p className="text-sm text-muted-foreground">
          Couldn&apos;t verify completeness — balances weren&apos;t found on the statement.
        </p>
      )}

      {s.extractionStatus === "failed" && s.extractionError && (
        <p className="rounded border border-destructive/40 bg-destructive/10 p-3 text-sm">
          {s.extractionError}
        </p>
      )}

      <TransactionsTable rows={rows} categories={cats} />
    </div>
  );
}
