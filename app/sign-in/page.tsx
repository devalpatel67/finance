import { SignInWithGoogle } from "@/components/sign-in-with-google";
import { Logo } from "@/components/logo";

const features = [
  "Upload PDF bank & card statements — any institution.",
  "Auto-categorized transactions, reconciled to the cent.",
  "Private by design — your data stays in your tenant.",
];

export default function SignInPage() {
  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      {/* Branded ledger panel — wordmark + URL pinned to corners, message centered */}
      <section className="relative hidden overflow-hidden bg-[#1a1c18] text-[#f3f4ef] lg:block">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.06]"
          style={{
            backgroundImage:
              "repeating-linear-gradient(to bottom, transparent 0 33px, #ffffff 33px 34px)",
          }}
        />
        <Logo tone="light" size={26} className="absolute left-12 top-12" />

        <div className="flex h-full items-center px-12">
          <div className="relative max-w-md">
            <h1 className="font-serif text-[2.5rem] font-medium leading-[1.12]">
              A clean <em className="text-[#7fd3a6] italic">ledger</em> from any statement.
            </h1>
            <ul className="mt-9 space-y-3.5">
              {features.map((f) => (
                <li key={f} className="flex items-start gap-3 text-[15px] text-[#cfd3cb]">
                  <svg width="16" height="16" viewBox="0 0 16 16" className="mt-1 shrink-0" aria-hidden>
                    <path d="M3 8.5l3 3 7-7" stroke="#7fd3a6" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  {f}
                </li>
              ))}
            </ul>
          </div>
        </div>

        <span className="absolute bottom-12 left-12 text-[11px] uppercase tracking-[0.14em] text-[#9aa197]">
          tabulafinance.com
        </span>
      </section>

      {/* Sign-in — vertically centered to align with the panel message */}
      <section className="flex items-center justify-center px-6 py-16">
        <div className="w-full max-w-sm">
          <div className="mb-9 lg:hidden">
            <Logo size={26} />
          </div>
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            Welcome
          </p>
          <h2 className="mt-1.5 font-serif text-2xl font-semibold">Sign in to Tabula</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Use your Google account to continue.
          </p>
          <div className="mt-7">
            <SignInWithGoogle />
          </div>
          <p className="mt-5 flex items-center gap-2 text-xs text-muted-foreground">
            <svg width="13" height="13" viewBox="0 0 16 16" className="shrink-0" aria-hidden>
              <path d="M8 1l5 2v4c0 3.5-2.2 6.4-5 7.5C5.2 13.4 3 10.5 3 7V3z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
            </svg>
            Google-only in v1. We never see your bank credentials.
          </p>
        </div>
      </section>
    </main>
  );
}
