import { normalizeDescription } from "./normalize";

/** Suggests a rule keyword: the leading run of the normalized description up to the first digit, '*' or '#'. */
export function suggestKeyword(description: string): string {
  const norm = normalizeDescription(description);
  const m = norm.match(/^[^0-9*#]+/);
  return (m ? m[0] : norm).trim();
}
