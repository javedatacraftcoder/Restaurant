// src/components/AutoRedirect.tsx
"use client";

import { useEffect, useRef } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useAuth } from "@/app/providers";
import { pickRouteByRole } from "@/lib/role-routes";

export default function AutoRedirect() {
  const { user, loading, claims, flags } = useAuth();
  const router = useRouter();

  // Normaliza pathname a string
  const pathnameRaw = usePathname();
  const pathname: string = typeof pathnameRaw === "string" && pathnameRaw ? pathnameRaw : "/";

  const didRun = useRef(false);

  useEffect(() => {
    if (didRun.current) return;
    if (loading) return;

    // Solo en Home
    if (pathname !== "/") return;
    if (!user) return;

    // pickRouteByRole siempre devuelve string; por si acaso, lo forzamos a string igualmente
    const dest: string = String(pickRouteByRole(flags as any, claims as any) || "/menu");

    if (dest !== pathname) {
      didRun.current = true;
      router.replace(dest);
    }
  }, [loading, user, claims, flags, router, pathname]);

  return null;
}
