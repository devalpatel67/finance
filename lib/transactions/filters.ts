const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Returns the value only if it is a well-formed UUID; otherwise undefined. */
export function parseUuid(value: string | undefined): string | undefined {
  return value && UUID_RE.test(value) ? value : undefined;
}

/**
 * Escapes LIKE/ILIKE wildcards (`%`, `_`) and the escape char itself so user
 * input matches literally instead of as a pattern. Postgres LIKE uses backslash
 * as the default escape character.
 */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}
