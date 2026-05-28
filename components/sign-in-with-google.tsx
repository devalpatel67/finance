"use client";

import { Button } from "@/components/ui/button";
import { signIn } from "@/lib/auth-client";

export function SignInWithGoogle() {
  return (
    <Button
      onClick={() =>
        signIn.social({ provider: "google", callbackURL: "/dashboard" })
      }
      size="lg"
    >
      Sign in with Google
    </Button>
  );
}
