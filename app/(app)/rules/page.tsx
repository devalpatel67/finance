import { headers } from "next/headers";
import { asc } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { scopedDb } from "@/lib/db/scoped";
import { categoryRules, categories } from "@/lib/db/schema";
import { RulesManager } from "@/components/rules-manager";

export default async function RulesPage() {
  const session = (await auth.api.getSession({ headers: await headers() }))!;
  const sdb = scopedDb(session.user.id);

  const [rules, cats] = await Promise.all([
    sdb.selectAll(categoryRules, { orderBy: asc(categoryRules.keyword) }),
    sdb.selectAll(categories),
  ]);
  const catById = new Map(cats.map((c) => [c.id, c]));
  const rows = rules.map((r) => ({
    id: r.id,
    keyword: r.keyword,
    categoryName: catById.get(r.categoryId)?.name ?? "—",
    color: catById.get(r.categoryId)?.color ?? "#9ca3af",
  }));

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Rules</h1>
      <p className="text-sm text-muted-foreground">
        Transactions whose description contains a keyword are categorized automatically.
        Your manual category edits are always kept.
      </p>
      <RulesManager rules={rows} />
    </div>
  );
}
