"use client";

import { PropsWithChildren, useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useAuth } from "@/app/providers";

/**
 * Exige que el usuario esté autenticado y tenga role=admin.
 * Si no, redirige a /login (o a / si prefieres).
 */
export default function RequireAdmin({ children }: PropsWithChildren) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  const isAdmin = ((user as any)?.role || "").toLowerCase() === "admin";

  useEffect(() => {
    if (loading) return;
    if (!user) {
      const next = encodeURIComponent(pathname || "/");
      router.replace(`/login?next=${next}`);
      return;
    }
    if (!isAdmin) {
      router.replace("/"); // o muestra 403 si prefieres
    }
  }, [user, isAdmin, loading, router, pathname]);

  if (loading) {
    return (
      <div className="container py-4">
        <div className="alert alert-info">Verificando permisos…</div>
      </div>
    );
  }

  if (!user || !isAdmin) return null;

  return <>{children}</>;
}
