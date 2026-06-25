import { headers } from "next/headers";
import { desc } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { scopedDb } from "@/lib/db/scoped";
import { transactions, categories, financialAccounts } from "@/lib/db/schema";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";
import { TransactionsTable } from "@/components/transactions-table";
import { TimeRangePicker } from "@/components/time-range-picker";
import {
  getSpendByCategory,
  getInflowTotal,
  getMonthlyCashFlow,
  getTopMerchants,
  getDailySpend,
} from "@/lib/queries/dashboard";
import { rankCategories } from "@/lib/dashboard/rank";
import { buildYearHeatmap } from "@/lib/dashboard/heatmap";
import { stitchAccountsIntoRows } from "@/lib/transactions/stitch-accounts";
import { formatRangeLabel, parseRange } from "@/lib/dates/ranges";
import { formatCurrency } from "@/lib/format/currency";
import { CashFlowBars } from "@/components/dashboard/cash-flow-bars";
import { CategoryRanking } from "@/components/dashboard/category-ranking";
import { TopMerchants } from "@/components/dashboard/top-merchants";
import { SpendHeatmap } from "@/components/dashboard/spend-heatmap";

type Search = { range?: string; from?: string; to?: string };

const DAY = 86_400_000;
const isoOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const msOf = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};

function Tile({ label, value, hint, positive }: { label: string; value: string; hint?: React.ReactNode; positive?: boolean }) {
  return (
    <Card className="min-w-0 p-5">
      <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
      <div className={`mt-2.5 truncate font-mono text-xl font-medium tabular-nums ${positive ? "text-positive" : ""}`} title={value}>{value}</div>
      {hint && <p className="mt-1.5 text-xs text-muted-foreground">{hint}</p>}
    </Card>
  );
}

function SectionHead({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="mb-4">
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="text-xs text-muted-foreground">{sub}</p>
    </div>
  );
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const session = (await auth.api.getSession({ headers: await headers() }))!;
  const userId = session.user.id;
  const sdb = scopedDb(userId);
  const range = parseRange(sp);

  const now = new Date();
  const todayMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const todayIso = isoOf(todayMs);

  // Prior comparison window (same length immediately before the current range).
  let priorFrom: string | null = null;
  let priorTo: string | null = null;
  if (range.fromIso) {
    const fromMs = msOf(range.fromIso);
    const toMs = range.toIso ? msOf(range.toIso) : todayMs;
    priorTo = isoOf(fromMs - DAY);
    priorFrom = isoOf(fromMs - DAY - (toMs - fromMs));
  }

  const [spend, inflow, cashflow, merchants, dailyYear, priorSpend] = await Promise.all([
    getSpendByCategory(userId, range.fromIso, range.toIso),
    getInflowTotal(userId, range.fromIso, range.toIso),
    getMonthlyCashFlow(userId, range.fromIso, range.toIso),
    getTopMerchants(userId, range.fromIso, range.toIso, 6),
    getDailySpend(userId, isoOf(todayMs - 364 * DAY), todayIso),
    priorFrom ? getSpendByCategory(userId, priorFrom, priorTo) : Promise.resolve(null),
  ]);

  const cats = await sdb.selectAll(categories);
  const recent = await sdb.selectAll(transactions, { orderBy: desc(transactions.postedAt), limit: 10 });
  const accts = await sdb.selectAll(financialAccounts);
  const currency = accts[0]?.currency ?? "USD";

  const ranked = rankCategories({
    current: spend,
    prior: priorSpend,
    categories: cats.map((c) => ({ id: c.id, name: c.name, color: c.color })),
  });
  const spent = ranked.reduce((s, r) => s + r.amount, 0);
  const net = inflow - spent;
  const avgMonth = cashflow.length > 0 ? spent / cashflow.length : spent;
  const priorSpent = priorSpend ? priorSpend.reduce((s, r) => s + Math.abs(Number(r.total)), 0) : null;
  const spentDelta = priorSpent && priorSpent > 0 ? Math.round(((spent - priorSpent) / priorSpent) * 100) : null;
  const heat = buildYearHeatmap(dailyYear, todayIso);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <TimeRangePicker />
      </div>

      {recent.length === 0 ? (
        <EmptyState
          title="No transactions yet"
          description="Upload your first statement to see your spending breakdown."
        />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Tile
              label={`Spent · ${formatRangeLabel(range)}`}
              value={formatCurrency(spent, currency)}
              hint={
                spentDelta != null ? (
                  <span className={spentDelta > 0 ? "text-[#9a4b2e]" : "text-positive"}>
                    {spentDelta > 0 ? "▲" : "▼"}{Math.abs(spentDelta)}% vs prior
                  </span>
                ) : (
                  `across ${accts.length} account${accts.length === 1 ? "" : "s"}`
                )
              }
            />
            <Tile label="Received" value={`+${formatCurrency(inflow, currency)}`} hint="deposits, refunds & transfers in" positive />
            <Tile label="Net cash flow" value={`${net >= 0 ? "+" : "−"}${formatCurrency(Math.abs(net), currency)}`} hint="in − out" positive={net >= 0} />
            <Tile label="Avg / month" value={formatCurrency(avgMonth, currency)} hint={`over ${cashflow.length || 1} month${cashflow.length === 1 ? "" : "s"}`} />
          </div>

          <Card className="p-5">
            <SectionHead title="Cash flow" sub="Money in vs out, by month" />
            <CashFlowBars months={cashflow} currency={currency} />
            <div className="mt-4 flex gap-5 text-xs text-muted-foreground">
              <span className="flex items-center gap-2"><span className="size-2.5 rounded-[3px] bg-positive" />In</span>
              <span className="flex items-center gap-2"><span className="size-2.5 rounded-[3px] bg-foreground/80" />Out</span>
            </div>
          </Card>

          <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
            <Card className="p-5">
              <SectionHead title="Where it goes" sub={`Spend by category${priorSpend ? " · vs prior period" : ""}`} />
              <CategoryRanking items={ranked} currency={currency} />
            </Card>
            <Card className="p-5">
              <SectionHead title="Top merchants" sub="Most spent, this range" />
              <TopMerchants merchants={merchants} currency={currency} />
            </Card>
          </div>

          <Card className="p-5">
            <SectionHead title="Spending calendar" sub="Daily outflow · last 12 months" />
            <SpendHeatmap grid={heat} currency={currency} />
          </Card>

          <Card className="p-5">
            <SectionHead title="Recent transactions" sub="Latest activity across all accounts" />
            <TransactionsTable rows={stitchAccountsIntoRows(recent, accts)} categories={cats} showAccount />
          </Card>
        </>
      )}
    </div>
  );
}
