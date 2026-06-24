import { headers } from "next/headers";
import { asc } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { scopedDb } from "@/lib/db/scoped";
import { categories } from "@/lib/db/schema";
import { CategoriesManager } from "@/components/categories-manager";

export default async function CategoriesPage() {
  const session = (await auth.api.getSession({ headers: await headers() }))!;
  const rows = await scopedDb(session.user.id).selectAll(categories, {
    orderBy: asc(categories.name),
  });

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Categories</h1>
      <CategoriesManager initial={rows} />
    </div>
  );
}
