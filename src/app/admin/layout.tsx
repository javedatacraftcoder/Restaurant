// src/app/admin/layout.tsx
'use client';

import React, { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';

/** --------- Firebase Auth (cliente) helpers --------- */
function getFirebaseClientConfig() {
  return {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY!,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN!,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID!,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID!,
  };
}
async function ensureFirebaseApp() {
  const app = await import('firebase/app');
  if (!app.getApps().length) {
    const cfg = getFirebaseClientConfig();
    if (cfg.apiKey && cfg.authDomain && cfg.projectId && cfg.appId) {
      app.initializeApp(cfg);
    } else {
      console.warn('[Firebase] Faltan variables NEXT_PUBLIC_* para Auth cliente.');
    }
  }
}
async function getAuthMod() {
  await ensureFirebaseApp();
  return await import('firebase/auth');
}

/** Obtiene user + claims (ID token) en cliente */
function useAuthClaims() {
  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState<any | null>(null);
  const [claims, setClaims] = useState<any | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { getAuth, onAuthStateChanged, getIdTokenResult } = await getAuthMod();
      const auth = getAuth();
      const unsub = onAuthStateChanged(auth, async (u) => {
        if (!alive) return;
        setUser(u ?? null);
        if (u) {
          try {
            const res = await getIdTokenResult(u);
            setClaims(res.claims || null);
          } catch {
            setClaims(null);
          }
        } else {
          setClaims(null);
        }
        setAuthReady(true);
      });
      return () => unsub();
    })();
    return () => {
      alive = false;
    };
  }, []);

  const flags = {
    isAdmin: !!claims?.admin,
    isKitchen: !!claims?.kitchen,
    isWaiter: !!claims?.waiter,
    isDelivery: !!claims?.delivery,
    isCashier: !!claims?.cashier,
  };

  return { authReady, user, claims, ...flags } as const;
}

/** --------- Reglas de acceso por ruta ---------
 * Orden importa: la primera que haga match se aplica.
 */
type RoleKey = 'admin' | 'kitchen' | 'waiter' | 'delivery' | 'cashier';

const RULES: Array<{ match: (path: string) => boolean; roles: RoleKey[] }> = [
  // Excepciones específicas:
  { match: (p) => p.startsWith('/admin/kitchen'), roles: ['admin', 'kitchen', 'waiter'] },
  { match: (p) => p.startsWith('/admin/cashier'), roles: ['admin', 'cashier'] },
  { match: (p) => p.startsWith('/admin/ops'), roles: ['admin'] },

  // Cualquier otra página dentro de /admin → solo admin
  { match: (p) => p.startsWith('/admin'), roles: ['admin'] },
];

/** Comprueba si el usuario cumple al menos un rol permitido */
function hasAnyAllowedRole(flags: Record<string, boolean>, allowed: RoleKey[]): boolean {
  for (const r of allowed) {
    if (flags[`is${r[0].toUpperCase()}${r.slice(1)}`] || (r === 'admin' && flags.isAdmin)) return true;
    // Nota: el nombre "isXxx" ya lo resolvimos arriba (isAdmin, isKitchen, etc.)
    if (r === 'kitchen' && flags.isKitchen) return true;
    if (r === 'waiter' && flags.isWaiter) return true;
    if (r === 'delivery' && flags.isDelivery) return true;
    if (r === 'cashier' && flags.isCashier) return true;
  }
  return false;
}

/** --------- Layout del segmento /admin --------- */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || '/admin';
  const { authReady, user, isAdmin, isKitchen, isWaiter, isDelivery, isCashier } = useAuthClaims();

  // Decide roles permitidos por la ruta actual
  const rule = RULES.find((r) => r.match(pathname)) || RULES[RULES.length - 1];
  const allowedRoles = rule.roles;

  const roleFlags = { isAdmin, isKitchen, isWaiter, isDelivery, isCashier };
  const allowed = !!user && hasAnyAllowedRole(roleFlags, allowedRoles);

  if (!authReady) {
    return (
      <div className="container py-3">
        Inicializando sesión…
      </div>
    );
  }

  if (!user) {
    return (
      <div className="container py-5">
        <div className="alert alert-danger">
          Debes iniciar sesión para acceder a esta sección.
        </div>
      </div>
    );
  }

  if (!allowed) {
    return (
      <div className="container py-5">
        <div className="alert alert-danger">
          No autorizado. Esta página requiere rol: <strong>{allowedRoles.join(' / ')}</strong>
        </div>
      </div>
    );
  }

  // Autorizado → renderizar children normalmente
  return <>{children}</>;
}
