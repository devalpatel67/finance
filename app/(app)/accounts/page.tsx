import Link from "next/link";
import { headers } from "next/headers";
import { eq, desc } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { financialAccounts } from "@/lib/db/schema";
import { AddAccountDialog } from "@/components/add-account-dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";

export default async function AccountsPage() {
  const session = (await auth.api.getSession({ headers: await headers() }))!;
  const rows = await db
    .select()
    .from(financialAccounts)
    .where(eq(financialAccounts.userId, session.user.id))
    .orderBy(desc(financialAccounts.createdAt));

  return (
    <div className="space-y-4">
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
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((a) => (
            <Card key={a.id} className="p-4">
              <Link href={`/accounts/${a.id}`} className="font-medium hover:underline">{a.name}</Link>
              <div className="text-sm text-muted-foreground">
                {a.kind}{a.institution ? ` · ${a.institution}` : ""}{a.last4 ? ` · …${a.last4}` : ""}
              </div>
              <div className="mt-2 text-xs text-muted-foreground">{a.currency}</div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
