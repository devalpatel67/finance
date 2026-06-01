import { describe, expect, it } from "vitest";

import { stitchAccountsIntoRows } from "@/lib/transactions/stitch-accounts";

describe("stitchAccountsIntoRows", () => {
  const accounts = [
    { id: "acc-1", name: "Chase Checking", last4: "1234" },
    { id: "acc-2", name: "Amex Gold", last4: null },
  ];

  it("attaches account details when financialAccountId matches", () => {
    const rows = [
      { id: "t1", financialAccountId: "acc-1" },
      { id: "t2", financialAccountId: "acc-2" },
    ];

    const out = stitchAccountsIntoRows(rows, accounts);

    expect(out[0].account).toEqual({ name: "Chase Checking", last4: "1234" });
    expect(out[1].account).toEqual({ name: "Amex Gold", last4: null });
  });

  it("leaves account undefined when no account matches", () => {
    const rows = [{ id: "t3", financialAccountId: "acc-missing" }];

    const out = stitchAccountsIntoRows(rows, accounts);

    expect(out[0].account).toBeUndefined();
  });
});
