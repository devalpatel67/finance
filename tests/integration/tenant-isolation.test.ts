import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { bootstrap, type TestEnv } from "../setup";

let envt: TestEnv;

beforeAll(async () => {
  envt = await bootstrap();
  process.env.DATABASE_URL = envt.databaseUrl;
}, 180_000);

afterAll(async () => {
  try {
    const { db } = await import("@/lib/db/client");
    const pool = (db as unknown as { $client?: { end?: () => Promise<void> } }).$client;
    if (pool?.end) await pool.end();
  } catch {
    // ignore
  }
  if (envt) await envt.stop();
}, 30_000);

describe("scopedDb tenant isolation", () => {
  it("only returns rows belonging to the scoped user", async () => {
    const { db } = await import("@/lib/db/client");
    const { users, financialAccounts, transactions } = await import("@/lib/db/schema");
    const { scopedDb } = await import("@/lib/db/scoped");

    await db.insert(users).values([
      { id: "owner", name: "Owner", email: "owner@x" },
      { id: "intruder", name: "Intruder", email: "intruder@x" },
    ]);
    const [ownerAcct] = await db
      .insert(financialAccounts)
      .values({ userId: "owner", name: "Owner Checking", kind: "checking", currency: "USD" })
      .returning();
    const [intruderAcct] = await db
      .insert(financialAccounts)
      .values({ userId: "intruder", name: "Intruder Checking", kind: "checking", currency: "USD" })
      .returning();

    await db.insert(transactions).values([
      { userId: "owner", financialAccountId: ownerAcct.id, postedAt: "2026-04-01", description: "Owner txn", amount: "-10.00", direction: "outflow", currency: "USD" },
      { userId: "intruder", financialAccountId: intruderAcct.id, postedAt: "2026-04-01", description: "Intruder txn", amount: "-99.00", direction: "outflow", currency: "USD" },
    ]);

    const owned = await scopedDb("owner").selectAll(transactions);
    expect(owned.map((r) => r.description)).toEqual(["Owner txn"]);

    // Even an explicit extra filter cannot reach across tenants: filtering by the
    // intruder's account id from the owner's scope yields nothing.
    const crossTenant = await scopedDb("owner").selectAll(transactions, {
      where: eq(transactions.financialAccountId, intruderAcct.id),
    });
    expect(crossTenant).toHaveLength(0);
  }, 60_000);
});
