import { SignInWithGoogle } from "@/components/sign-in-with-google";

export default function SignInPage() {
  return (
    <main className="flex min-h-screen items-center justify-center">
      <div className="flex flex-col items-center gap-6 max-w-sm text-center">
        <h1 className="text-3xl font-semibold">Finance Tracker</h1>
        <p className="text-muted-foreground">
          Sign in to upload statements and track spending.
        </p>
        <SignInWithGoogle />
      </div>
    </main>
  );
}
