// src/app/(client)/layout.tsx
'use client';

import type { ReactNode } from 'react';
import Protected from '@/components/Protected'; // exige sesión iniciada

export default function ClientAreaLayout({ children }: { children: ReactNode }) {
  // 🔐 Este wrapper hace que TODAS las rutas dentro del grupo (client) requieran login.
  //    No restringe por rol: cualquier usuario autenticado puede ingresar.
  return (
    <Protected>
      {children}
    </Protected>
  );
}
