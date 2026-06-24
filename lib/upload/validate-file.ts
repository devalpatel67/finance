export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export function validateUploadFile(file: { type: string; size: number }): { ok: true } | { ok: false; error: string } {
  if (file.type !== "application/pdf") return { ok: false, error: "Only PDF files are allowed" };
  if (file.size > MAX_UPLOAD_BYTES) return { ok: false, error: "File exceeds 10 MB" };
  return { ok: true };
}
