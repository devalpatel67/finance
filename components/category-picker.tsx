"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { updateTransactionCategory } from "@/lib/actions/update-transaction";
import { createCategoryRule } from "@/lib/actions/category-rules";
import { suggestKeyword } from "@/lib/categories/keyword";

type Category = { id: string; name: string; color: string };

export function CategoryPicker({
  transactionId,
  categoryId,
  categories,
  description,
}: {
  transactionId: string;
  categoryId: string | null;
  categories: Category[];
  description: string;
}) {
  const [, start] = useTransition();
  const [prompt, setPrompt] = useState<{ keyword: string; categoryId: string; categoryName: string } | null>(null);

  return (
    <>
      <Select
        value={categoryId ?? undefined}
        onValueChange={(v) => {
          start(() => updateTransactionCategory({ transactionId, categoryId: v || null }));
          const cat = categories.find((c) => c.id === v);
          if (v && cat) {
            // Offer rule creation via a toast action rather than opening the dialog
            // here: opening a Radix Dialog inside the Select's onValueChange races
            // with the Select closing and dismisses the dialog instantly. The toast
            // action is a clean later click, so the dialog opens reliably.
            toast.success(`Categorized as ${cat.name}`, {
              action: {
                label: "Make a rule",
                onClick: () =>
                  setPrompt({ keyword: suggestKeyword(description), categoryId: v, categoryName: cat.name }),
              },
            });
          }
        }}
      >
        <SelectTrigger className="h-7 w-fit gap-1.5 border-0 bg-transparent px-2 text-xs shadow-none hover:bg-muted focus-visible:ring-0 focus-visible:bg-muted data-[state=open]:bg-muted [&>svg]:size-3 [&>svg]:opacity-40 hover:[&>svg]:opacity-70 data-[state=open]:[&>svg]:opacity-70">
          <SelectValue placeholder="Uncategorized" />
        </SelectTrigger>
        <SelectContent>
          {categories.map((c) => (
            <SelectItem key={c.id} value={c.id}>
              <span className="inline-flex items-center gap-2">
                <span className="inline-block h-2 w-2 rounded-full" style={{ background: c.color }} />
                {c.name}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Dialog open={prompt !== null} onOpenChange={(o) => !o && setPrompt(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Make this a rule?</DialogTitle>
          </DialogHeader>
          {prompt && (
            <div className="space-y-3 text-sm">
              <p>
                Always categorize transactions containing this keyword as{" "}
                <span className="font-medium">{prompt.categoryName}</span>:
              </p>
              <Input
                value={prompt.keyword}
                onChange={(e) => setPrompt({ ...prompt, keyword: e.target.value })}
              />
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPrompt(null)}>No thanks</Button>
            <Button
              onClick={() => {
                if (!prompt) return;
                const p = prompt;
                setPrompt(null);
                start(() => createCategoryRule({ keyword: p.keyword, categoryId: p.categoryId }));
              }}
            >
              Create rule
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
