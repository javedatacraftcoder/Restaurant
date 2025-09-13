// src/app/account/page.tsx
"use client";

import { FormEvent, useEffect, useState } from "react";
import { createUserWithEmailAndPassword, updateProfile } from "firebase/auth";
import { auth } from "@/lib/firebase/client";
import { useRouter } from "next/navigation";
import { useAuth } from "@/app/providers";

export default function AccountsRegisterPage() {
  const router = useRouter();
  const { user, loading } = useAuth();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [pass1, setPass1] = useState("");
  const [pass2, setPass2] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Si ya está logueado, fuera de aquí
  useEffect(() => {
    if (!loading && user) {
      router.replace("/");
    }
  }, [loading, user, router]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErr(null);

    if (pass1 !== pass2) {
      setErr("Passwords don{t match");
      return;
    }
    if (name.trim().length < 2) {
      setErr("Enter your name.");
      return;
    }

    setBusy(true);
    try {
      const cred = await createUserWithEmailAndPassword(
        auth,
        email.trim(),
        pass1
      );

      // Actualiza perfil (displayName)
      await updateProfile(cred.user, {
        displayName: name.trim(),
      });

      // 🔗 Inicializa/“sincroniza” el doc customers/{uid} llamando al endpoint protegido
      try {
        const token = await cred.user.getIdToken();
        await fetch("/api/customers/me", {
          method: "GET",
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        // No es crítico manejar la respuesta aquí: el doc se crea/actualiza en el backend.
      } catch {
        // Ignorar cualquier error aquí; el doc también se creará al abrir /user-config
      }

      // Redirige al home (o donde gustes)
      router.replace("/");
    } catch (e: any) {
      setErr(e?.message || "The account could not be created.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="container py-4" style={{ maxWidth: 520 }}>
      <h1 className="h3 mb-3 text-center">Create account</h1>

      <form onSubmit={onSubmit} className="card p-3 border-0 shadow-sm">
        <div className="mb-3">
          <label className="form-label">Name</label>
          <input
            className="form-control"
            type="text"
            placeholder="Your name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            disabled={busy}
          />
        </div>

        <div className="mb-3">
          <label className="form-label">Email</label>
          <input
            className="form-control"
            type="email"
            autoComplete="email"
            placeholder="you@youremail.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            disabled={busy}
          />
        </div>

        <div className="mb-3">
          <label className="form-label">Password</label>
          <input
            className="form-control"
            type="password"
            autoComplete="new-password"
            placeholder="Minimum 6 characters"
            value={pass1}
            onChange={(e) => setPass1(e.target.value)}
            required
            disabled={busy}
            minLength={6}
          />
        </div>

        <div className="mb-3">
          <label className="form-label">Confirm Password</label>
          <input
            className="form-control"
            type="password"
            autoComplete="new-password"
            placeholder="Confirm password"
            value={pass2}
            onChange={(e) => setPass2(e.target.value)}
            required
            disabled={busy}
            minLength={6}
          />
        </div>

        <button className="btn btn-success w-100" disabled={busy}>
          {busy ? "Creating..." : "Create account"}
        </button>

        {err && <p className="text-danger mt-3 mb-0">{err}</p>}
      </form>

      <p className="text-center mt-3 mb-0">
        Already have an account?{" "}
        <a href="/login" className="link-primary">Sign in</a>
      </p>
    </main>
  );
}
