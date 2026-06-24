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
    opening_balance: z.number().finite().optional(),
    closing_balance: z.number().finite().optional(),
  }),
  transactions: z.array(
    z.object({
      posted_at: isoDate,
      description: z.string().min(1),
      amount: z.number().finite(),
      suggested_category: z.string().min(1),
      direction: z.enum(["outflow", "inflow", "transfer"]).optional(),
      merchant: z.string().min(1).optional(),
    }),
  ),
});

export type ExtractionResult = z.infer<typeof ExtractionResult>;

export type Direction = "outflow" | "inflow" | "transfer";

export function resolveDirection(t: { amount: number; direction?: Direction }): Direction {
  // Sign-derived fallback matches the migration's `amount >= 0 -> inflow` semantics.
  return t.direction ?? (t.amount < 0 ? "outflow" : "inflow");
}

const BASE_SYSTEM_PROMPT = `You extract financial transactions from a bank or credit-card statement PDF.

Rules:
- Return JSON matching the provided schema exactly.
- amount is signed: negative for outflows (purchases, fees), positive for inflows (deposits, refunds).
- Use ISO 8601 dates (YYYY-MM-DD).
- suggested_category must be a short label like "Groceries", "Dining", "Transport", "Utilities", "Bills", "Subscriptions", "Shopping", "Entertainment", "Health", "Travel", "Income", "Transfers", "Fees", "Other".
- Set \`direction\` to \`outflow\` for money leaving the account (purchases, fees, ATM withdrawals), \`inflow\` for money entering (deposits, refunds, paychecks), or \`transfer\` for movements between the user's own accounts (e.g. credit card payments, internal transfers). When in doubt, infer from the sign of amount.
- Report the statement's stated opening/previous balance as \`opening_balance\` and the closing/new balance as \`closing_balance\`, as printed. For credit-card statements these are the previous balance and the new balance owed. Omit them only if the statement does not show them.
- Also return \`merchant\`: a short, human-friendly business or brand name for the transaction (e.g. "Amazon", "A&W", "Spotify", "Interest charge"). Strip store numbers, URLs, cities and province codes. Omit it only when no sensible name can be derived.
- Include every transaction; do not summarize or skip rows.`;

export function buildSystemPrompt(categoryNames: string[]): string {
  if (categoryNames.length === 0) return BASE_SYSTEM_PROMPT;
  return (
    BASE_SYSTEM_PROMPT +
    `\n- Choose suggested_category from this list when one fits: ${categoryNames.join(", ")}. If none fit, use a short free-text label.`
  );
}

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
          opening_balance: { type: "number" },
          closing_balance: { type: "number" },
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
            merchant: { type: "string" },
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
  categoryNames: string[];
}): Promise<ExtractionResult> {
  assertAllowedModel(opts.model);

  const base64 = opts.pdf.toString("base64");

  const completion = await openrouter.chat.completions.create({
    model: opts.model,
    response_format: { type: "json_schema", json_schema: JSON_SCHEMA },
    messages: [
      { role: "system", content: buildSystemPrompt(opts.categoryNames) },
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
