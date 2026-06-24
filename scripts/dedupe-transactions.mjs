/**
 * One-off cleanup for duplicate transactions created by uploading the same
 * statement more than once (see ARC-238). Going forward, content-hash dedup in
 * extractStatement prevents this; this script removes the rows already created.
 *
 * Dry-run by default — prints what it WOULD delete and changes nothing.
 * Pass --apply to actually delete (runs inside a transaction).
 *
 *   node scripts/dedupe-transactions.mjs                       # dry run
 *   node scripts/dedupe-transactions.mjs --apply               # delete dup rows
 *   node scripts/dedupe-transactions.mjs --apply --drop-empty  # + drop statements left with no transactions
 *
 * Grouping is deliberately conservative: rows are considered duplicates only
 * when they share (user, account, posted_at, amount) AND a whitespace/
 * case-insensitive description AND span more than one statement. That last
 * condition is the re-upload fingerprint — two genuinely distinct same-day,
 * same-amount purchases live in a single statement and are left untouched.
 * Within each duplicate group the earliest-created row is kept.
 */
import { config } from "dotenv";
import { Pool } from "pg";

config({ path: ".env.local" });

const APPLY = process.argv.includes("--apply");
const DROP_EMPTY = process.argv.includes("--drop-empty");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set (.env.local).");
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const QUERY = `
  WITH norm AS (
    SELECT id, user_id, financial_account_id, posted_at, amount, description,
           statement_id, created_at,
           lower(regexp_replace(description, '\\s+', '', 'g')) AS nd
    FROM transactions
  ),
  groups AS (
    SELECT user_id, financial_account_id, posted_at, amount, nd
    FROM norm
    GROUP BY user_id, financial_account_id, posted_at, amount, nd
    HAVING count(*) > 1 AND count(DISTINCT statement_id) > 1
  )
  SELECT n.id, n.user_id, n.financial_account_id, n.posted_at, n.amount,
         n.description, n.statement_id, n.created_at, n.nd
  FROM norm n
  JOIN groups g
    ON  n.user_id = g.user_id
   AND  n.financial_account_id = g.financial_account_id
   AND  n.posted_at = g.posted_at
   AND  n.amount = g.amount
   AND  n.nd = g.nd
  ORDER BY n.user_id, n.financial_account_id, n.posted_at, n.amount, n.nd, n.created_at;
`;

function keyOf(r) {
  return `${r.user_id}|${r.financial_account_id}|${r.posted_at}|${r.amount}|${r.nd}`;
}

async function main() {
  const { rows } = await pool.query(QUERY);

  const groups = new Map();
  for (const r of rows) {
    const k = keyOf(r);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }

  const toDelete = [];
  const dupStmtIds = new Set();
  for (const members of groups.values()) {
    // rows already ordered by created_at asc → keep the first, delete the rest
    const [keep, ...dupes] = members;
    console.log(
      `\n${keep.posted_at}  ${keep.amount}  "${keep.description}"  (${members.length} rows)`,
    );
    console.log(`  KEEP   ${keep.id}  stmt=${keep.statement_id ?? "—"}`);
    for (const d of dupes) {
      console.log(`  DELETE ${d.id}  stmt=${d.statement_id ?? "—"}  "${d.description}"`);
      toDelete.push(d.id);
      if (d.statement_id) dupStmtIds.add(d.statement_id);
    }
  }

  console.log(
    `\n${groups.size} duplicate group(s), ${toDelete.length} row(s) to delete.`,
  );
  if (DROP_EMPTY) {
    console.log(
      `--drop-empty: will drop any of ${dupStmtIds.size} affected statement(s) left with no transactions.`,
    );
  }

  if (!APPLY) {
    console.log("Dry run — nothing deleted. Re-run with --apply to delete.");
    return;
  }
  if (toDelete.length === 0) return;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM transactions WHERE id = ANY($1::uuid[])", [toDelete]);
    let droppedStmts = 0;
    if (DROP_EMPTY && dupStmtIds.size > 0) {
      const res = await client.query(
        `DELETE FROM statements s
         WHERE s.id = ANY($1::uuid[])
           AND NOT EXISTS (SELECT 1 FROM transactions t WHERE t.statement_id = s.id)`,
        [[...dupStmtIds]],
      );
      droppedStmts = res.rowCount;
    }
    await client.query("COMMIT");
    console.log(`Deleted ${toDelete.length} row(s); dropped ${droppedStmts} empty statement(s).`);
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

main()
  .then(() => pool.end())
  .catch((e) => {
    console.error(e);
    pool.end();
    process.exit(1);
  });
