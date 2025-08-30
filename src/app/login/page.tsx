// src/app/login/page.tsx
"use client";

import { auth, googleProvider } from "@/lib/firebase/client";
import {
  signInWithEmailAndPassword,
  signInWithPopup,
  getIdTokenResult,
} from "firebase/auth";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "../providers";

function computeTargetFromClaims(c: any): string {
  const op =
    c?.admin ||
    c?.kitchen ||
    c?.waiter ||
    c?.delivery ||
    c?.cashier ||
    c?.role === "admin" ||
    c?.role === "kitchen" ||
    c?.role === "waiter" ||
    c?.role === "delivery" ||
    c?.role === "cashier";

  if (c?.admin || c?.role === "admin") return "/admin";
  if (op) return "/ops";
  return "/app";
}

export default function LoginPage() {
  const router = useRouter();
  const { user, loading } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [redirecting, setRedirecting] = useState(false);

  // Si ya está logueado, redirigir según rol
  useEffect(() => {
    (async () => {
      if (loading || !user || redirecting) return;
      try {
        const { claims } = await getIdTokenResult(user);
        const to = computeTargetFromClaims(claims || {});
        setRedirecting(true);
        router.replace(to);
      } catch {
        // Si algo falla, caer a /app
        setRedirecting(true);
        router.replace("/app");
      }
    })();
  }, [loading, user, router, redirecting]);

  async function loginEmail(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
      // onIdTokenChanged en <Providers> hará el resto (sync cookie + redirect effect)
    } catch (e: any) {
      setErr(e?.message || "Error al iniciar sesión");
    }
  }

  async function loginGoogle() {
    setErr(null);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (e: any) {
      setErr(e?.message || "No se pudo iniciar sesión con Google");
    }
  }

  if (!loading && user && redirecting) {
    return <main style={{ padding: 24 }}>Entrando…</main>;
  }

  return (
    <main style={{ padding: 24, maxWidth: 420, margin: "0 auto" }}>
      <h1 className="h4 mb-3">Iniciar sesión</h1>

      <form onSubmit={loginEmail} className="d-grid gap-2">
        <label className="form-label">Correo</label>
        <input
          className="form-control"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="username"
          required
        />

        <label className="form-label mt-2">Contraseña</label>
        <input
          className="form-control"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
        />

        <button type="submit" className="btn btn-primary mt-3" disabled={loading}>
          Entrar
        </button>
      </form>

      <hr className="my-3" />

      <button onClick={loginGoogle} className="btn btn-outline-secondary w-100" disabled={loading}>
        Entrar con Google
      </button>

      {err && <p className="text-danger mt-3">{err}</p>}
    </main>
  );
}
