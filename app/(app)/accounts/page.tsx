import Link from "next/link";
import { headers } from "next/headers";
import { desc } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { scopedDb } from "@/lib/db/scoped";
import { financialAccounts } from "@/lib/db/schema";
import { AddAccountDialog } from "@/components/add-account-dialog";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import { PaymentCard } from "@/components/payment-card";

export default async function AccountsPage() {
  const session = (await auth.api.getSession({ headers: await headers() }))!;
  const rows = await scopedDb(session.user.id).selectAll(financialAccounts, {
    orderBy: desc(financialAccounts.createdAt),
  });

  return (
    <div className="space-y-5">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Accounts</h1>
        <AddAccountDialog trigger={<Button>Add account</Button>} />
      </header>

      {rows.length === 0 ? (
        <EmptyState
          title="No accounts yet"
          description="Add an account to start uploading statements."
          action={<AddAccountDialog trigger={<Button>Add account</Button>} />}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((a) => (
            <Link key={a.id} href={`/accounts/${a.id}`} className="rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60">
              <PaymentCard
                interactive
                data={{
                  institution: a.institution,
                  name: a.name,
                  kind: a.kind,
                  last4: a.last4,
                  currency: a.currency,
                  network: a.network,
                }}
              />
            </Link>
          ))}
          <AddAccountDialog
            trigger={
              <button
                type="button"
                className="flex aspect-[1.586/1] flex-col items-center justify-center gap-2 rounded-2xl border-[1.5px] border-dashed border-border bg-card text-muted-foreground transition-colors hover:border-brand hover:bg-accent hover:text-brand"
              >
                <span className="flex size-9 items-center justify-center rounded-full border-[1.5px] border-current text-xl leading-none">+</span>
                <span className="text-sm font-semibold">Add account</span>
              </button>
            }
          />
        </div>
      )}
    </div>
  );
}
