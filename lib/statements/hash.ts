import { createHash } from "node:crypto";

/** SHA-256 hex digest of a file's bytes — used to detect re-uploads of an identical statement PDF. */
export function sha256Hex(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}
