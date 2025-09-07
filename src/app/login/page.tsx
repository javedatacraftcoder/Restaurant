// src/app/login/page.tsx
"use client";

import { Suspense } from "react";
import AuthNavbar from "@/components/AuthNavbar";

export const dynamic = "force-dynamic";

function Fallback() {
  return (
    <main className="container py-4" style={{ maxWidth: 480 }}>
      <h1 className="h4 text-center">Cargando…</h1>
    </main>
  );
}

export default function LoginPage() {
  return (
    <>
      <AuthNavbar />
      <Suspense fallback={<Fallback />}>
        <LoginInner />
      </Suspense>
    </>
  );
}

// --------- componente real ----------
import { FormEvent, useEffect, useRef, useState, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
} from "firebase/auth";
import { auth, googleProvider } from "@/lib/firebase/client";
import { useAuth } from "@/app/providers";

function LoginInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { user, loading } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const inFlightRef = useRef(false);

  const forceRedirect = useMemo(
    () => process.env.NEXT_PUBLIC_AUTH_USE_REDIRECT === "true",
    []
  );

  useEffect(() => {
    if (!loading && user) {
      const next = params.get("next") || "/";
      router.replace(next);
    }
  }, [loading, user, params, router]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy || inFlightRef.current) return;
    setErr(null);
    setBusy(true);
    inFlightRef.current = true;
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
      const next = params.get("next") || "/";
      router.replace(next);
    } catch (e: any) {
      setErr(e?.message || "No se pudo iniciar sesión.");
    } finally {
      inFlightRef.current = false;
      setBusy(false);
    }
  }

  async function loginGoogle() {
    if (busy || inFlightRef.current) return;
    setErr(null);
    setBusy(true);
    inFlightRef.current = true;
    try {
      if (forceRedirect) {
        await signInWithRedirect(auth, googleProvider);
        return;
      }
      await signInWithPopup(auth, googleProvider);
      const next = params.get("next") || "/";
      router.replace(next);
    } catch (e: any) {
      const code = e?.code || "";
      const shouldFallback =
        code === "auth/popup-closed-by-user" ||
        code === "auth/cancelled-popup-request" ||
        code === "auth/popup-blocked";
      if (shouldFallback) {
        try {
          await signInWithRedirect(auth, googleProvider);
          return;
        } catch (er: any) {
          setErr(er?.message || "No se pudo iniciar con Google (redirect).");
        }
      } else {
        setErr(e?.message || "No se pudo iniciar con Google.");
      }
    } finally {
      inFlightRef.current = false;
      setBusy(false);
    }
  }

  return (
    <main className="container py-4" style={{ maxWidth: 480 }}>
      <h1 className="h3 mb-3 text-center">Iniciar sesión</h1>
      <form onSubmit={onSubmit} className="card p-3 border-0 shadow-sm">
        <div className="mb-3">
          <label className="form-label">Correo</label>
          <input
            className="form-control"
            type="email"
            autoComplete="email"
            placeholder="tu@correo.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            disabled={busy}
          />
        </div>
        <div className="mb-3">
          <label className="form-label">Contraseña</label>
          <input
            className="form-control"
            type="password"
            autoComplete="current-password"
            placeholder="********"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            disabled={busy}
          />
        </div>
        <button className="btn btn-primary w-100" disabled={busy}>
          {busy ? "Entrando..." : "Entrar"}
        </button>
        {err && <p className="text-danger mt-3 mb-0">{err}</p>}
      </form>

      <div className="text-center my-3">— o —</div>

      <button
        type="button"
        onClick={loginGoogle}
        className="btn btn-outline-secondary w-100"
        disabled={busy}
      >
        {busy
          ? forceRedirect
            ? "Redirigiendo a Google..."
            : "Abriendo Google..."
          : forceRedirect
          ? "Entrar con Google (redirect)"
          : "Entrar con Google"}
      </button>

      <p className="text-center mt-3 mb-0">
        ¿No tienes cuenta?{" "}
        <a href="/accounts" className="link-primary">
          Regístrate
        </a>
      </p>
    </main>
  );
}
