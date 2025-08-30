// src/components/Topbar.tsx
'use client';

import { usePathname } from 'next/navigation';

export default function Topbar() {
  const pathname = usePathname() || '/';

  // Ocultamos completamente el topbar global dentro de las áreas con layout propio
  if (
    pathname.startsWith('/app') ||
    pathname.startsWith('/admin') ||
    pathname.startsWith('/ops')
  ) {
    return null;
  }

  // Si quieres un topbar para páginas públicas, ponlo aquí.
  // Por ahora devolvemos null para no duplicar barras.
  return null;
}
