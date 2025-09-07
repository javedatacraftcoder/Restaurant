"use client";

import { useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signInWithCustomToken } from "firebase/auth";
import { auth } from "@/lib/firebase/client";

export default function FirebaseCompleteClient() {
  const router = useRouter();
  const params = useSearchParams();
  const onceRef = useRef(false);

  useEffect(() => {
    if (onceRef.current) return;
    onceRef.current = true;

    const next = params.get("next") || "/app";

    (async () => {
      try {
        // 1) Custom token desde NextAuth
        const res = await fetch("/api/auth/firebase-token", {
          credentials: "include",
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`TOKEN_HTTP_${res.status}`);
        const { token } = await res.json();

        // 2) Login Firebase con custom token
        await signInWithCustomToken(auth, token);

        // 3) Cookie de rol y destino final
        try {
          const idToken = await auth.currentUser!.getIdToken(true);
          const r2 = await fetch("/api/auth/role-cookie", {
            method: "GET",
            headers: { Authorization: `Bearer ${idToken}` },
            cache: "no-store",
          });
          if (r2.ok) {
            const { target } = await r2.json();
            router.replace(target || next);
            return;
          }
        } catch { /* noop */ }

        // 4) Fallback
        router.replace(next);
      } catch {
        router.replace(`/login?next=${encodeURIComponent(next)}`);
      }
    })();
  }, [params, router]);

  return null; // sin UI
}
