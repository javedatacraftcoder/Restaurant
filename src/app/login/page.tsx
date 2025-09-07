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
import { FormEvent, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signInWithEmailAndPassword, getIdTokenResult } from "firebase/auth";
import { auth } from "@/lib/firebase/client";
import { useAuth } from "@/app/providers";
import { pickRouteByRole } from "@/lib/role-routes"; // 👈 agregado

// Helpers
type AppRole = "admin" | "kitchen" | "cashier" | "waiter" | "delivery" | "customer";

function computeAppRole(claims: Record<string, any> | null | undefined): AppRole {
  if (!claims) return "customer";
  if (claims.admin) return "admin";
  if (claims.kitchen) return "kitchen";
  if (claims.cashier) return "cashier";
  if (claims.waiter) return "waiter";
  if (claims.delivery) return "delivery";
  const r = String(claims.role || "").toLowerCase();
  if (r === "admin" || r === "kitchen" || r === "cashier" || r === "waiter" || r === "delivery") {
    return r as AppRole;
  }
  return "customer";
}

function setCookie(name: string, value: string) {
  const base = `${name}=${encodeURIComponent(value)}; Path=/; SameSite=Lax`;
  const extra = typeof window !== "undefined" && window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = base + extra;
}

async function syncRoleCookiesAndRedirect(params: URLSearchParams, router: ReturnType<typeof useRouter>) {
  const u = auth.currentUser;
  if (!u) return;

  // Lee claims del ID token actual
  const tok = await getIdTokenResult(u, true);
  const role = computeAppRole(tok.claims);

  // Cookies que usa tu middleware
  setCookie("session", "1");
  setCookie("appRole", role);

  // Destino:
  // - si no tiene rol → respeta ?next= o /app
  // - si tiene rol → usa mapeo fino de pickRouteByRole
  const requested = params.get("next") || "/app";
  const pathByRole = pickRouteByRole({}, tok.claims as any);
  const dest = role === "customer" ? requested : pathByRole;

  router.replace(dest);
}

function LoginInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { user, loading } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const inFlightRef = useRef(false);

  // Si ya hay sesión al entrar a /login, sincroniza cookies+rol y redirige
  useEffect(() => {
    (async () => {
      if (!loading && user) {
        try {
          await syncRoleCookiesAndRedirect(params, router);
        } catch {
          // fallback mínimo si algo falla leyendo claims
          const requested = params.get("next") || "/app";
          router.replace(requested);
        }
      }
    })();
  }, [loading, user, params, router]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy || inFlightRef.current) return;
    setErr(null);
    setBusy(true);
    inFlightRef.current = true;
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
      await syncRoleCookiesAndRedirect(params, router);
    } catch (e: any) {
      setErr(e?.message || "No se pudo iniciar sesión.");
    } finally {
      inFlightRef.current = false;
      setBusy(false);
    }
  }

  // Google solo para clientes (no afecta roles/admin)
  const nextParam = encodeURIComponent(params.get("next") || "/app");
  const hrefGoogle = `/auth/google/start?next=${nextParam}`;

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

      {/* Google: solo clientes */}
      <a href={hrefGoogle} className="btn btn-outline-secondary w-100">
        Login con Google
      </a>

      <p className="text-center mt-3 mb-0">
        ¿No tienes cuenta?{" "}
        <a href="/accounts" className="link-primary">
          Regístrate
        </a>
      </p>
    </main>
  );
}
