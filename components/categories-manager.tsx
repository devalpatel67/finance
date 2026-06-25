"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { saveCategory, deleteCategory } from "@/lib/actions/categories";
import { CATEGORY_PALETTE, DEFAULT_CATEGORY_COLOR } from "@/lib/categories/palette";
import { cn } from "@/lib/utils";

type Cat = { id: string; name: string; color: string; isSystem: boolean };

export function CategoriesManager({ initial }: { initial: Cat[] }) {
  const [draft, setDraft] = useState({ name: "", color: DEFAULT_CATEGORY_COLOR });
  const [, start] = useTransition();

  return (
    <div className="space-y-4">
      <form
        className="flex flex-wrap items-end gap-3"
        action={() => start(async () => {
          await saveCategory(draft);
          setDraft({ name: "", color: DEFAULT_CATEGORY_COLOR });
        })}
      >
        <div className="grid gap-1">
          <span className="text-xs text-muted-foreground">Name</span>
          <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} required />
        </div>
        <div className="grid gap-1">
          <span className="text-xs text-muted-foreground">Color</span>
          <div className="flex items-center gap-1.5">
            {CATEGORY_PALETTE.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={c}
                onClick={() => setDraft({ ...draft, color: c })}
                className={cn(
                  "size-5 rounded-full ring-offset-2 ring-offset-background transition",
                  draft.color.toLowerCase() === c ? "ring-2 ring-foreground" : "hover:scale-110",
                )}
                style={{ background: c }}
              />
            ))}
            <input
              type="color"
              value={draft.color}
              onChange={(e) => setDraft({ ...draft, color: e.target.value })}
              className="size-6 cursor-pointer rounded border-0 bg-transparent p-0"
              title="Custom color"
            />
          </div>
        </div>
        <Button type="submit">Add</Button>
      </form>

      <ul className="divide-y rounded border">
        {initial.map((c) => (
          <li key={c.id} className="flex items-center justify-between p-3">
            <span className="inline-flex items-center gap-2">
              <span className="h-3 w-3 rounded-full" style={{ background: c.color }} />
              {c.name}
              {c.isSystem && <span className="text-xs text-muted-foreground">system</span>}
            </span>
            {!c.isSystem && (
              <Button variant="ghost" size="sm" onClick={() => start(() => deleteCategory(c.id))}>
                Delete
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
