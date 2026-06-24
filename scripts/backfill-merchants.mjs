/**
 * One-off backfill of transactions.merchant for rows that predate the merchant
 * field (ARC-246). Derives a short merchant name from each distinct description
 * via a cheap LLM call — no statement PDFs needed.
 *
 *   node scripts/backfill-merchants.mjs           # dry run (prints proposed names)
 *   node scripts/backfill-merchants.mjs --apply   # write merchant for matching rows
 *
 * Idempotent: only touches rows where merchant IS NULL. Descriptions the model
 * can't name are left null (the row keeps showing its raw description).
 */
import { config } from "dotenv";
import { Pool } from "pg";
import OpenAI from "openai";

config({ path: ".env.local" });

const APPLY = process.argv.includes("--apply");
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set (.env.local).");
  process.exit(1);
}
if (!process.env.OPENROUTER_API_KEY) {
  console.error("OPENROUTER_API_KEY is not set (.env.local).");
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const ai = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY,
});
const MODEL = "google/gemini-2.5-flash";
const BATCH = 80;

const SYSTEM = `You normalize noisy bank/credit-card transaction descriptions into short, human-friendly merchant or brand names.
Return a JSON object mapping each input description (verbatim key) to a short name like "Amazon", "A&W", "Spotify", or "Interest charge".
Use "" (empty string) when no sensible name can be derived. Strip store numbers, URLs, cities, and province codes. Do not invent details.`;

async function nameBatch(descriptions) {
  const completion = await ai.chat.completions.create({
    model: MODEL,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: JSON.stringify(descriptions) },
    ],
  });
  const raw = completion.choices[0]?.message?.content ?? "{}";
  return JSON.parse(raw);
}

async function main() {
  const { rows } = await pool.query(
    "SELECT DISTINCT description FROM transactions WHERE merchant IS NULL ORDER BY description",
  );
  const descriptions = rows.map((r) => r.description);
  console.log(`${descriptions.length} distinct un-named description(s).`);
  if (descriptions.length === 0) return;

  const mapping = {};
  for (let i = 0; i < descriptions.length; i += BATCH) {
    const slice = descriptions.slice(i, i + BATCH);
    const m = await nameBatch(slice);
    for (const d of slice) {
      const name = typeof m[d] === "string" ? m[d].trim() : "";
      if (name) mapping[d] = name;
    }
  }

  for (const [d, name] of Object.entries(mapping)) {
    console.log(`  ${name}  ⇐  ${d}`);
  }
  console.log(`\n${Object.keys(mapping).length} description(s) would be named${APPLY ? "" : " (dry run)"}.`);

  if (!APPLY) {
    console.log("Re-run with --apply to write.");
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const [d, name] of Object.entries(mapping)) {
      await client.query(
        "UPDATE transactions SET merchant = $1 WHERE description = $2 AND merchant IS NULL",
        [name, d],
      );
    }
    await client.query("COMMIT");
    console.log(`Applied ${Object.keys(mapping).length} merchant name(s).`);
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
