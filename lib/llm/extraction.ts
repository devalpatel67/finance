import { z } from "zod";
import { openrouter } from "./openrouter";
import { assertAllowedModel, type ModelId } from "./models";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "ISO date required");

export const ExtractionResult = z.object({
  account_summary: z.object({
    institution: z.string().optional(),
    last4: z.string().optional(),
    period_start: isoDate,
    period_end: isoDate,
    currency: z.string().length(3),
  }),
  transactions: z.array(
    z.object({
      posted_at: isoDate,
      description: z.string().min(1),
      amount: z.number().finite(),
      suggested_category: z.string().min(1),
      direction: z.enum(["outflow", "inflow", "transfer"]).optional(),
    }),
  ),
});

export type ExtractionResult = z.infer<typeof ExtractionResult>;

export type Direction = "outflow" | "inflow" | "transfer";

export function resolveDirection(t: { amount: number; direction?: Direction }): Direction {
  // Sign-derived fallback matches the migration's `amount >= 0 -> inflow` semantics.
  return t.direction ?? (t.amount < 0 ? "outflow" : "inflow");
}

const SYSTEM_PROMPT = `You extract financial transactions from a bank or credit-card statement PDF.

Rules:
- Return JSON matching the provided schema exactly.
- amount is signed: negative for outflows (purchases, fees), positive for inflows (deposits, refunds).
- Use ISO 8601 dates (YYYY-MM-DD).
- suggested_category must be a short label like "Groceries", "Dining", "Transport", "Utilities", "Bills", "Subscriptions", "Shopping", "Entertainment", "Health", "Travel", "Income", "Transfers", "Fees", "Other".
- Set \`direction\` to \`outflow\` for money leaving the account (purchases, fees, ATM withdrawals), \`inflow\` for money entering (deposits, refunds, paychecks), or \`transfer\` for movements between the user's own accounts (e.g. credit card payments, internal transfers). When in doubt, infer from the sign of amount.
- Include every transaction; do not summarize or skip rows.`;

const JSON_SCHEMA = {
  name: "ExtractionResult",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["account_summary", "transactions"],
    properties: {
      account_summary: {
        type: "object",
        additionalProperties: false,
        required: ["period_start", "period_end", "currency"],
        properties: {
          institution: { type: "string" },
          last4: { type: "string" },
          period_start: { type: "string" },
          period_end: { type: "string" },
          currency: { type: "string" },
        },
      },
      transactions: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["posted_at", "description", "amount", "suggested_category"],
          properties: {
            posted_at: { type: "string" },
            description: { type: "string" },
            amount: { type: "number" },
            suggested_category: { type: "string" },
            direction: { type: "string", enum: ["outflow", "inflow", "transfer"] },
          },
        },
      },
    },
  },
} as const;

export async function extractFromPdf(opts: {
  pdf: Buffer;
  model: ModelId;
  filename: string;
}): Promise<ExtractionResult> {
  assertAllowedModel(opts.model);

  const base64 = opts.pdf.toString("base64");

  const completion = await openrouter.chat.completions.create({
    model: opts.model,
    response_format: { type: "json_schema", json_schema: JSON_SCHEMA },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          { type: "text", text: "Extract every transaction from this statement." },
          {
            type: "file",
            file: { filename: opts.filename, file_data: `data:application/pdf;base64,${base64}` },
          } as any,
        ],
      },
    ],
  });

  const raw = completion.choices[0]?.message?.content;
  if (!raw || typeof raw !== "string") throw new Error("Empty LLM response");

  return ExtractionResult.parse(JSON.parse(raw));
}
