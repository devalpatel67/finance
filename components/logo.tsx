import { cn } from "@/lib/utils";

/**
 * Tabula wordmark: a stacked ledger-rule glyph + the name set in the serif
 * display face. `tone="light"` is for dark backgrounds (e.g. the sign-in panel).
 */
export function Logo({
  className,
  size = 22,
  tone = "default",
  showWordmark = true,
}: {
  className?: string;
  size?: number;
  tone?: "default" | "light";
  showWordmark?: boolean;
}) {
  const bar = tone === "light" ? "#5fbf8c" : "var(--brand)";
  const word = tone === "light" ? "text-white" : "text-foreground";
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 30 30"
        aria-hidden
        className="shrink-0"
      >
        <rect x="2" y="5" width="26" height="3.4" rx="1.4" fill={bar} />
        <rect x="2" y="13.3" width="26" height="3.4" rx="1.4" fill={bar} />
        <rect x="2" y="21.6" width="17" height="3.4" rx="1.4" fill={bar} />
      </svg>
      {showWordmark && (
        <span
          className={cn("font-serif font-semibold tracking-tight", word)}
          style={{ fontSize: size * 0.95 }}
        >
          Tabula
        </span>
      )}
    </span>
  );
}
