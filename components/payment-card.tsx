import { cn } from "@/lib/utils";
import { bankBrand } from "@/lib/accounts/brand";
import { kindLabel } from "@/lib/accounts/kind-label";
import type { AccountKind } from "@/lib/accounts/resolve-account";

export type CardNetwork = "visa" | "mastercard" | "amex" | "other" | null;

export type PaymentCardData = {
  institution: string | null;
  name: string;
  kind: AccountKind;
  last4: string | null;
  currency: string;
  network: CardNetwork;
};

function NetworkMark({ network }: { network: CardNetwork }) {
  if (network === "visa") {
    return (
      <span
        className="text-[21px] font-bold italic leading-none tracking-wide text-white [text-shadow:0_1px_0_rgba(0,0,0,0.25)]"
        style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}
      >
        VISA
      </span>
    );
  }
  if (network === "mastercard") {
    return (
      <span className="inline-flex items-center" aria-label="Mastercard">
        <span className="block size-6 rounded-full bg-[#eb001b]" />
        <span className="-ml-2.5 block size-6 rounded-full bg-[#f79e1b] mix-blend-screen" />
      </span>
    );
  }
  if (network === "amex") {
    return (
      <span className="rounded-[3px] bg-white px-1.5 py-[3px] text-[9px] font-extrabold tracking-wider text-[#006fcf]">
        AMEX
      </span>
    );
  }
  return null;
}

function Chip() {
  return (
    <span className="relative block h-7 w-9 rounded-md bg-[linear-gradient(135deg,#f2d98a,#b8973f)]">
      <span className="absolute inset-[5px_7px] rounded-[3px] border border-[rgba(120,90,20,0.5)]" />
      <span className="absolute inset-y-1 left-1/2 w-px bg-[rgba(120,90,20,0.5)]" />
    </span>
  );
}

function maskedNumber(network: CardNetwork, last4: string | null) {
  const tail = last4 ?? "••••";
  if (network === "amex") return `•••• •••••• •${tail}`;
  return `•••• •••• •••• ${tail}`;
}

export function PaymentCard({
  data,
  interactive = false,
  className,
}: {
  data: PaymentCardData;
  interactive?: boolean;
  className?: string;
}) {
  const brand = bankBrand(data.institution);
  const isCredit = data.kind === "credit";

  return (
    <div
      className={cn(
        "relative flex aspect-[1.586/1] flex-col justify-between overflow-hidden rounded-2xl p-5 text-white",
        "shadow-[0_1px_2px_rgba(0,0,0,0.06),0_16px_30px_-22px_rgba(0,0,0,0.55)]",
        interactive &&
          "transition-transform duration-150 hover:-translate-y-0.5 hover:shadow-[0_1px_2px_rgba(0,0,0,0.06),0_24px_44px_-22px_rgba(0,0,0,0.6)]",
        className,
      )}
      style={{ backgroundImage: `linear-gradient(135deg, ${brand.from}, ${brand.to})` }}
    >
      {/* sheen */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ background: "radial-gradient(120% 80% at 0% 0%, rgba(255,255,255,0.16), transparent 55%)" }}
      />

      <div className="relative flex items-start justify-between">
        <div className="leading-tight">
          <div className="font-serif text-base font-semibold">{brand.label}</div>
          {brand.sub && (
            <div className="mt-0.5 text-[9.5px] font-medium uppercase tracking-[0.16em] text-white/70">
              {brand.sub}
            </div>
          )}
        </div>
        {isCredit ? (
          <NetworkMark network={data.network} />
        ) : (
          <span className="text-[9.5px] uppercase tracking-[0.16em] text-white/75">
            {kindLabel(data.kind)}
          </span>
        )}
      </div>

      <Chip />

      <div className="relative font-mono text-[15px] tracking-[0.14em] [text-shadow:0_1px_1px_rgba(0,0,0,0.25)]">
        {maskedNumber(data.network, data.last4)}
      </div>

      <div className="relative flex items-end justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-xs font-semibold uppercase tracking-[0.04em]">
            {data.name || "New account"}
          </div>
          <div className="mt-0.5 text-[11px] text-white/70">
            {kindLabel(data.kind)} · {data.currency || "—"}
          </div>
        </div>
      </div>
    </div>
  );
}
