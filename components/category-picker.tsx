"use client";

import { useTransition } from "react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { updateTransactionCategory } from "@/lib/actions/update-transaction";

export function CategoryPicker({
  transactionId,
  categoryId,
  categories,
}: {
  transactionId: string;
  categoryId: string | null;
  categories: { id: string; name: string; color: string }[];
}) {
  const [, start] = useTransition();

  return (
    <Select
      value={categoryId ?? undefined}
      onValueChange={(v) =>
        start(() =>
          updateTransactionCategory({
            transactionId,
            categoryId: v || null,
          }),
        )
      }
    >
      <SelectTrigger className="h-8 text-xs">
        <SelectValue placeholder="Uncategorized" />
      </SelectTrigger>
      <SelectContent>
        {categories.map((c) => (
          <SelectItem key={c.id} value={c.id}>
            <span className="inline-flex items-center gap-2">
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ background: c.color }}
              />
              {c.name}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
