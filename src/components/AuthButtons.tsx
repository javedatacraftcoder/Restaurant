"use client";
import Link from "next/link";
import { signOut } from "firebase/auth";
import { auth } from "@/lib/firebase/client";
import { useAuth } from "@/app/providers";

export default function AuthButtons() {
  const { user, loading } = useAuth();
  if (loading) return null;

  if (user) {
    return (
      <div style={{ display: "flex", gap: 12 }}>
        <Link href="/admin">Admin</Link>
        <button onClick={() => signOut(auth)}>Cerrar sesión</button>
      </div>
    );
  }
  return <Link href="/login">Iniciar sesión</Link>;
}
