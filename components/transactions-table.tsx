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

type Row = {
  id: string;
  postedAt: string;
  description: string;
  amount: string;
  currency: string;
  categoryId: string | null;
};

type Category = { id: string; name: string; color: string };

const fmt = (amount: string, currency: string) =>
  new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
  }).format(Number(amount));

export function TransactionsTable({
  rows,
  categories,
}: {
  rows: Row[];
  categories: Category[];
}) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">No transactions.</p>;
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-[110px]">Date</TableHead>
          <TableHead>Description</TableHead>
          <TableHead className="w-[180px]">Category</TableHead>
          <TableHead className="w-[120px] text-right">Amount</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.id}>
            <TableCell>{r.postedAt}</TableCell>
            <TableCell>{r.description}</TableCell>
            <TableCell>
              <CategoryPicker
                transactionId={r.id}
                categoryId={r.categoryId}
                categories={categories}
              />
            </TableCell>
            <TableCell
              className={`text-right tabular-nums ${
                Number(r.amount) < 0 ? "text-foreground" : "text-emerald-600"
              }`}
            >
              {fmt(r.amount, r.currency)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
