/** Normalizes description text for rule matching and reprocess key-matching. */
export function normalizeDescription(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, " ");
}
