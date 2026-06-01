"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { CategoryPicker } from "./category-picker";
import { DirectionBadge } from "./direction-badge";

type Row = {
  id: string;
  postedAt: string;
  description: string;
  amount: string;
  currency: string;
  categoryId: string | null;
  direction: "outflow" | "inflow" | "transfer";
  account?: { name: string; last4: string | null };
};

type Category = { id: string; name: string; color: string };

const fmt = (amount: string, currency: string) =>
  new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
  }).format(Math.abs(Number(amount)));

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
        <TableRow>
          <TableHead className="w-[110px]">Date</TableHead>
          {showAccount && <TableHead className="w-[180px]">Account</TableHead>}
          <TableHead>Description</TableHead>
          <TableHead className="w-[180px]">Category</TableHead>
          <TableHead className="w-[140px]">Direction</TableHead>
          <TableHead className="w-[120px] text-right">Amount</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.id}>
            <TableCell>{r.postedAt}</TableCell>
            {showAccount && (
              <TableCell className="whitespace-nowrap text-sm">
                {r.account ? (
                  <>
                    {r.account.name}
                    {r.account.last4 && (
                      <span className="ml-1 text-muted-foreground">··{r.account.last4}</span>
                    )}
                  </>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
            )}
            <TableCell>{r.description}</TableCell>
            <TableCell>
              <CategoryPicker
                transactionId={r.id}
                categoryId={r.categoryId}
                categories={categories}
              />
            </TableCell>
            <TableCell>
              <DirectionBadge direction={r.direction} />
            </TableCell>
            <TableCell className="text-right tabular-nums text-foreground">
              {fmt(r.amount, r.currency)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
