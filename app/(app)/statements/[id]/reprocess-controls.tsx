"use client";

import { useTransition } from "react";
import { toast } from "sonner";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { MODELS } from "@/lib/llm/models";
import { reprocessStatement } from "@/lib/actions/reprocess-statement";

export function ReprocessControls({
  statementId,
  currentModel,
}: {
  statementId: string;
  currentModel: string;
}) {
  const [pending, start] = useTransition();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" disabled={pending}>
          {pending ? "Reprocessing…" : "Reprocess with…"}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {MODELS.map((m) => (
          <DropdownMenuItem
            key={m.id}
            disabled={m.id === currentModel}
            onClick={() =>
              start(async () => {
                try {
                  await reprocessStatement(statementId, m.id);
                  toast.success("Reprocessed");
                } catch (e) {
                  toast.error("Reprocess failed", { description: (e as Error).message });
                }
              })
            }
          >
            {m.label}
            <span className="ml-2 text-xs text-muted-foreground">{m.id}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
