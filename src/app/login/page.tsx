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

export default function LoginPage() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [redirecting, setRedirecting] = useState(false);

  // Redirección basada en claims (roles)
  useEffect(() => {
    if (loading || !user || redirecting) return;
    (async () => {
      try {
        setRedirecting(true);
        const res = await getIdTokenResult(user, true);
        const c = res?.claims || {};
        const isOperator = !!(c.admin || c.kitchen || c.waiter || c.delivery);
        router.replace(isOperator ? "/ops" : "/playground/order");
      } catch {
        // fallback si falla leer claims
        router.replace("/playground/order");
      }
    })();
  }, [loading, user, router, redirecting]);

  if (!loading && user && redirecting) {
    return <main style={{ padding: 24 }}>Redirigiendo…</main>;
  }

  const loginEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    try {
      await signInWithEmailAndPassword(auth, email, password);
      // El useEffect hará la redirección
    } catch (e: any) {
      setErr(e.message);
    }
  };

  const loginGoogle = async () => {
    setErr(null);
    try {
      await signInWithPopup(auth, googleProvider);
      // El useEffect hará la redirección
    } catch (e: any) {
      setErr(e.message);
    }
  };

  return (
    <main style={{ padding: 24, maxWidth: 420 }}>
      <h1>Iniciar sesión</h1>
      <form onSubmit={loginEmail} style={{ display: "grid", gap: 12 }}>
        <input
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <input
          placeholder="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <button type="submit" disabled={loading}>
          Entrar
        </button>
      </form>
      <button onClick={loginGoogle} style={{ marginTop: 12 }} disabled={loading}>
        Entrar con Google
      </button>
      {err && <p style={{ color: "crimson" }}>{err}</p>}
    </main>
  );
}
