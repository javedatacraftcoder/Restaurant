"use client";
import { useAuth } from "@/app/providers";

export default function AdminOnly({ children }: { children: React.ReactNode }) {
  const { role, loading } = useAuth();
  if (loading) return <p style={{ padding: 24 }}>Cargando…</p>;
  if (role !== "admin") return <p style={{ padding: 24, color: "crimson" }}>Acceso denegado.</p>;
  return <>{children}</>;
}
