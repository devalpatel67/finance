import { normalizeInstitution } from "./resolve-account";

export type BankBrand = {
  /** Wordmark shown on the card. */
  label: string;
  /** Small line under the wordmark (e.g. "Royal Bank"). */
  sub?: string;
  /** Card gradient stops. */
  from: string;
  to: string;
};

// Brand COLORS only (no licensed logos). Each entry lists the normalized
// institution tokens it matches. Order matters only for readability.
const BRANDS: Array<BankBrand & { match: string[] }> = [
  { match: ["rbc", "royalbankofcanada", "royalbank"], label: "RBC", sub: "Royal Bank", from: "#0a2a6b", to: "#003da5" },
  { match: ["td", "tdcanadatrust", "tdbank"], label: "TD", sub: "Canada Trust", from: "#00610a", to: "#008a00" },
  { match: ["scotiabank", "bankofnovascotia", "scotia"], label: "Scotiabank", from: "#a10d14", to: "#ec111a" },
  { match: ["bmo", "bankofmontreal"], label: "BMO", sub: "Bank of Montreal", from: "#004a87", to: "#0079c1" },
  { match: ["cibc", "canadianimperialbankofcommerce"], label: "CIBC", from: "#8b0e1a", to: "#c8102e" },
  { match: ["americanexpress", "amex"], label: "American Express", from: "#0a4f93", to: "#006fcf" },
  { match: ["tangerine"], label: "Tangerine", from: "#c84e00", to: "#ff6900" },
  { match: ["simplii", "simpliifinancial"], label: "Simplii", from: "#5a1a6b", to: "#8e44ad" },
];

const FALLBACK = { from: "#15160f", to: "#2a2d26" };

/**
 * Maps an institution to its card brand. Unknown institutions fall back to the
 * Tabula ink gradient and use the institution string (or "Account") as the
 * wordmark, so every card still reads cleanly.
 */
export function bankBrand(institution: string | null | undefined): BankBrand {
  if (institution) {
    const n = normalizeInstitution(institution);
    const hit = BRANDS.find((b) => b.match.some((m) => n === m || n.includes(m) || m.includes(n)));
    if (hit) return { label: hit.label, sub: hit.sub, from: hit.from, to: hit.to };
    return { label: institution.trim(), ...FALLBACK };
  }
  return { label: "Account", ...FALLBACK };
}
