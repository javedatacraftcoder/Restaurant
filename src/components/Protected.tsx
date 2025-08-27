"use client";
import { useAuth } from "@/app/providers";
import Link from "next/link";

export default function Protected({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <p style={{ padding: 24 }}>Cargando…</p>;
  if (!user) return <p style={{ padding: 24 }}>Necesitas iniciar sesión. <Link href="/login">Ir a login</Link></p>;
  return <>{children}</>;
}
