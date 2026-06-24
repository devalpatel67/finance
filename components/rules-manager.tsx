"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import { deleteCategoryRule } from "@/lib/actions/category-rules";

type Rule = { id: string; keyword: string; categoryName: string; color: string };

export function RulesManager({ rules }: { rules: Rule[] }) {
  const [, start] = useTransition();

  if (rules.length === 0) {
    return (
      <EmptyState
        title="No rules yet"
        description='Recategorize a transaction and choose "Create rule" to add one.'
      />
    );
  }

  return (
    <ul className="divide-y rounded border">
      {rules.map((r) => (
        <li key={r.id} className="flex items-center justify-between gap-4 p-3 text-sm">
          <div className="flex items-center gap-2">
            <span>contains</span>
            <code className="rounded bg-muted px-1.5 py-0.5">{r.keyword}</code>
            <span>→</span>
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: r.color }} />
              {r.categoryName}
            </span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => start(() => deleteCategoryRule(r.id))}
          >
            Delete
          </Button>
        </li>
      ))}
    </ul>
  );
}
