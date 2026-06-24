"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { createCategoryRule, deleteCategoryRule } from "@/lib/actions/category-rules";

type Rule = { id: string; keyword: string; categoryName: string; color: string };
type Category = { id: string; name: string; color: string };

export function RulesManager({
  rules,
  categories,
}: {
  rules: Rule[];
  categories: Category[];
}) {
  const [, start] = useTransition();
  const [keyword, setKeyword] = useState("");
  const [categoryId, setCategoryId] = useState("");

  const canAdd = keyword.trim().length > 0 && categoryId.length > 0;

  return (
    <div className="space-y-4">
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!canAdd) return;
          const k = keyword;
          const c = categoryId;
          setKeyword("");
          setCategoryId("");
          start(() => createCategoryRule({ keyword: k, categoryId: c }));
        }}
      >
        <label className="grid gap-1 text-sm">
          <span className="text-muted-foreground">Keyword (description contains)</span>
          <Input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="e.g. starbucks"
            className="w-56"
          />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="text-muted-foreground">Category</span>
          <Select value={categoryId || undefined} onValueChange={setCategoryId}>
            <SelectTrigger className="w-48"><SelectValue placeholder="Choose…" /></SelectTrigger>
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
        </label>
        <Button type="submit" disabled={!canAdd}>Add rule</Button>
      </form>

      {rules.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No rules yet. Add one above, or recategorize a transaction and choose “Make a rule”.
        </p>
      ) : (
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
              <Button variant="ghost" size="sm" onClick={() => start(() => deleteCategoryRule(r.id))}>
                Delete
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
