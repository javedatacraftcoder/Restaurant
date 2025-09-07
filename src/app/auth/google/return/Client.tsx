"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getRedirectResult, AuthError } from "firebase/auth";
import { auth, ensureLocalPersistence } from "@/lib/firebase/client";
import { useAuth } from "@/app/providers";

const NEXT_KEY = "login_next_after_google";

export default function GoogleReturnClient() {
  const router = useRouter();
  const params = useSearchParams();
  const { user: ctxUser, loading } = useAuth();

  const [phase, setPhase] = useState("idle");
  const [code, setCode] = useState<string | null>(null);
  const processedRef = useRef(false);

  useEffect(() => {
    if (processedRef.current) return;
    processedRef.current = true;

    (async () => {
      try {
        // 👇 Asegura persistencia LOCAL ANTES de leer el resultado
        setPhase("ensuring_persistence");
        await ensureLocalPersistence();

        setPhase("checking_redirect_result");
        const res = await getRedirectResult(auth);

        if (res?.user) {
          setPhase("redirect_result_has_user");
          const next = sessionStorage.getItem(NEXT_KEY) || params.get("next") || "/app";
          sessionStorage.removeItem(NEXT_KEY);
          router.replace(next);
          return;
        }

        if (!loading && (ctxUser || auth.currentUser)) {
          setPhase("context_has_user");
          const next = sessionStorage.getItem(NEXT_KEY) || params.get("next") || "/app";
          sessionStorage.removeItem(NEXT_KEY);
          router.replace(next);
          return;
        }

        setPhase("redirect_result_empty");
      } catch (e: any) {
        setCode((e as AuthError)?.code ?? null);
        setPhase("redirect_result_error");
      }
    })();
  }, [router, params, loading, ctxUser]);

  return (
    <main className="container py-4" style={{ maxWidth: 520 }}>
      <h1 className="h4 mb-3">Procesando inicio de sesión…</h1>
      <div className="card p-3">
        <div>Fase: <code>{phase}</code></div>
        {code && (
          <div className="mt-2">
            Código: <code>{code}</code>
          </div>
        )}
        <div className="mt-3 d-flex gap-2">
          <a href="/login" className="btn btn-outline-secondary">Volver al login</a>
          <a href="/auth/google/start" className="btn btn-secondary">Intentar de nuevo</a>
        </div>
      </div>
    </main>
  );
}
