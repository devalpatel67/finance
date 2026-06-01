"use client";

import { useTransition } from "react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { updateTransactionDirection } from "@/lib/actions/update-transaction";

import { DirectionBadge, type Direction } from "./direction-badge";

const OPTIONS: Direction[] = ["outflow", "inflow", "transfer"];

export function DirectionPicker({
  transactionId,
  direction,
}: {
  transactionId: string;
  direction: Direction;
}) {
  const [, start] = useTransition();

  return (
    <Select
      value={direction}
      onValueChange={(v) =>
        start(() =>
          updateTransactionDirection({
            transactionId,
            direction: v as Direction,
          }),
        )
      }
    >
      <SelectTrigger className="h-8 text-xs">
        <SelectValue>
          <DirectionBadge direction={direction} />
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {OPTIONS.map((d) => (
          <SelectItem key={d} value={d}>
            <DirectionBadge direction={d} />
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
