"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";

export default function GoogleStartClient() {
  const params = useSearchParams();

  useEffect(() => {
    const next = params.get("next") || "/app";
    // Enviamos a NextAuth con callback que pasa por el bridge y termina en /app
    signIn("google", {
      callbackUrl: `/api/auth/session-bridge?next=${encodeURIComponent(next)}`,
      prompt: "select_account",
    });
  }, [params]);

  return (
    <main className="container py-4" style={{ maxWidth: 520 }}>
      <h1 className="h4 mb-3">Conectando con Google…</h1>
      <div className="card p-3">
        <p className="mb-0 text-muted">Si no ves la ventana, revisa bloqueadores o recarga.</p>
      </div>
    </main>
  );
}
