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
      setErr("Las contraseñas no coinciden.");
      return;
    }
    if (name.trim().length < 2) {
      setErr("Ingresa tu nombre.");
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

      // Redirige al home (o donde gustes)
      router.replace("/");
    } catch (e: any) {
      setErr(e?.message || "No se pudo crear la cuenta.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="container py-4" style={{ maxWidth: 520 }}>
      <h1 className="h3 mb-3 text-center">Crear cuenta</h1>

      <form onSubmit={onSubmit} className="card p-3 border-0 shadow-sm">
        <div className="mb-3">
          <label className="form-label">Nombre</label>
          <input
            className="form-control"
            type="text"
            placeholder="Tu nombre"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            disabled={busy}
          />
        </div>

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
            autoComplete="new-password"
            placeholder="Mínimo 6 caracteres"
            value={pass1}
            onChange={(e) => setPass1(e.target.value)}
            required
            disabled={busy}
            minLength={6}
          />
        </div>

        <div className="mb-3">
          <label className="form-label">Confirmar contraseña</label>
          <input
            className="form-control"
            type="password"
            autoComplete="new-password"
            placeholder="Repite la contraseña"
            value={pass2}
            onChange={(e) => setPass2(e.target.value)}
            required
            disabled={busy}
            minLength={6}
          />
        </div>

        <button className="btn btn-success w-100" disabled={busy}>
          {busy ? "Creando..." : "Crear cuenta"}
        </button>

        {err && <p className="text-danger mt-3 mb-0">{err}</p>}
      </form>

      <p className="text-center mt-3 mb-0">
        ¿Ya tienes cuenta?{" "}
        <a href="/login" className="link-primary">Inicia sesión</a>
      </p>
    </main>
  );
}
