"use client";

import { PropsWithChildren, useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useAuth } from "@/app/providers";

/**
 * Envuelve cualquier sección que deba exigir login.
 * Si no hay usuario, redirige a /login conservando ?next=... para volver.
 */
export default function RequireAuth({ children }: PropsWithChildren) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (loading) return;              // aún verificando sesión
    if (!user) {
      const next = encodeURIComponent(pathname || "/");
      router.replace(`/login?next=${next}`);
    }
  }, [user, loading, router, pathname]);

  if (loading) {
    return (
      <div className="container py-4">
        <div className="alert alert-info">Verificando sesión…</div>
      </div>
    );
  }

  // Si no hay user, ya estamos redirigiendo: no parpadear la UI protegida
  if (!user) return null;

  return <>{children}</>;
}
