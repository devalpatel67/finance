"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { formatCurrency } from "@/lib/format/currency";
import { CategoryPicker } from "./category-picker";

type Row = {
  id: string;
  postedAt: string;
  description: string;
  merchant: string | null;
  amount: string;
  currency: string;
  categoryId: string | null;
  direction: "outflow" | "inflow" | "transfer";
  account?: { name: string; last4: string | null };
};

type Category = { id: string; name: string; color: string };

const headClass =
  "h-9 text-[11px] font-medium uppercase tracking-wider text-muted-foreground";

// Direction lives on the amount, not in a column: outflows are the quiet default
// (− neutral), inflows read positive (+ emerald), transfers are muted (⇄). The
// sign/glyph carries meaning so it never depends on color alone.
function Amount({
  amount,
  currency,
  direction,
}: {
  amount: string;
  currency: string;
  direction: Row["direction"];
}) {
  const value = formatCurrency(amount, currency);
  if (direction === "inflow") {
    return <span className="tabular-nums font-medium text-emerald-600">+{value}</span>;
  }
  if (direction === "transfer") {
    return (
      <span className="tabular-nums font-medium text-muted-foreground" title="Transfer">
        <span aria-hidden className="mr-1 text-xs">⇄</span>
        {value}
      </span>
    );
  }
  return <span className="tabular-nums font-medium text-foreground/80">−{value}</span>;
}

export function TransactionsTable({
  rows,
  categories,
  showAccount = false,
}: {
  rows: Row[];
  categories: Category[];
  showAccount?: boolean;
}) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">No transactions.</p>;
  }
  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className={`${headClass} w-[104px]`}>Date</TableHead>
          {showAccount && <TableHead className={`${headClass} w-[210px]`}>Account</TableHead>}
          <TableHead className={headClass}>Description</TableHead>
          <TableHead className={`${headClass} w-[190px]`}>Category</TableHead>
          <TableHead className={`${headClass} w-[140px] text-right`}>Amount</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.id}>
            <TableCell className="whitespace-nowrap text-sm tabular-nums text-muted-foreground">
              {r.postedAt}
            </TableCell>
            {showAccount && (
              <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                {r.account ? (
                  <>
                    {r.account.name}
                    {r.account.last4 && <span className="ml-1 opacity-60">··{r.account.last4}</span>}
                  </>
                ) : (
                  <span>—</span>
                )}
              </TableCell>
            )}
            <TableCell title={r.description}>
              <div className="font-medium text-foreground/90">{r.merchant ?? r.description}</div>
              {r.merchant && (
                <div className="truncate text-xs text-muted-foreground">{r.description}</div>
              )}
            </TableCell>
            <TableCell>
              <CategoryPicker
                transactionId={r.id}
                categoryId={r.categoryId}
                categories={categories}
                description={r.description}
              />
            </TableCell>
            <TableCell className="text-right">
              <Amount amount={r.amount} currency={r.currency} direction={r.direction} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
