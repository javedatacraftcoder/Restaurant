// src/app/admin/layout.tsx
'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

/* ===== Autenticación para fetch con idToken (igual que en otras páginas) ===== */
function getFirebaseClientConfig() {
  return {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY!,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN!,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID!,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID!,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  };
}
async function ensureFirebaseApp() {
  const app = await import('firebase/app');
  if (!app.getApps().length) {
    const cfg = getFirebaseClientConfig();
    if (cfg.apiKey && cfg.authDomain && cfg.projectId && cfg.appId) {
      app.initializeApp(cfg);
    }
  }
}
async function getAuthMod() {
  await ensureFirebaseApp();
  const mod = await import('firebase/auth');
  return mod;
}
async function getIdTokenSafe(forceRefresh = false): Promise<string | null> {
  try {
    const { getAuth } = await getAuthMod();
    const auth = getAuth();
    const user = auth.currentUser;
    if (!user) return null;
    return await user.getIdToken(forceRefresh);
  } catch {
    return null;
  }
}
async function apiFetch(path: string, init?: RequestInit) {
  let token = await getIdTokenSafe(false);
  let headers: HeadersInit = { ...(init?.headers || {}) };
  if (token) (headers as any)['Authorization'] = `Bearer ${token}`;
  let res = await fetch(path, { ...init, headers });
  if (res.status === 401) {
    token = await getIdTokenSafe(true);
    headers = { ...(init?.headers || {}) };
    if (token) (headers as any)['Authorization'] = `Bearer ${token}`;
    res = await fetch(path, { ...init, headers });
  }
  return res;
}

/* ===== Tipos y hook de contadores ===== */
type NavCounts = {
  kitchenPending: number;
  cashierQueue: number;
  deliveryPending: number;
};

function useNavCounts(pollMs = 15000) {
  const [counts, setCounts] = useState<NavCounts | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      setErr(null);
      setLoading(true);
      const res = await apiFetch('/api/admin/nav-counts', { cache: 'no-store' });
      const data = await res.json().catch(() => ({} as any));
      if (!res.ok || data?.ok === false) throw new Error(data?.error || `HTTP ${res.status}`);
      setCounts({
        kitchenPending: Number(data.kitchenPending || 0),
        cashierQueue: Number(data.cashierQueue || 0),
        deliveryPending: Number(data.deliveryPending || 0),
      });
    } catch (e: any) {
      setErr(e?.message || 'No se pudieron cargar los contadores');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!alive) return;
      await load();
      if (!alive) return;
      const id = setInterval(load, pollMs);
      return () => clearInterval(id);
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pollMs]);

  return { counts, err, loading, reload: load } as const;
}

/* ======= NUEVO: hook para contar mesas activas (dine-in con estado abierto) ======= */
function useActiveTablesCount(pollMs = 15000) {
  const [count, setCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const OPEN_STATUSES = ['placed','kitchen_in_progress','kitchen_done','ready_to_close'] as const;

  const load = async () => {
    try {
      setLoading(true);
      await ensureFirebaseApp();
      const { getFirestore, collection, query, where, getDocs, limit } = await import('firebase/firestore');
      const db = getFirestore();

      // Una sola 'in' por status (4 valores) — es válido y eficiente
      const qRef = query(
        collection(db, 'orders'),
        where('orderInfo.type', '==', 'dine-in'),
        where('status', 'in', OPEN_STATUSES as unknown as string[]),
        limit(1000) // seguridad: evita descargar demasiado (ajusta si tu volumen es mayor)
      );

      const snap = await getDocs(qRef);
      const tables = new Set<string>();
      snap.forEach(doc => {
        const data: any = doc.data();
        const t = String(data?.orderInfo?.table ?? '').trim();
        if (t) tables.add(t);
      });
      setCount(tables.size);
    } catch {
      // en error, no rompemos la UI
      setCount(0);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!alive) return;
      await load();
      if (!alive) return;
      const id = setInterval(load, pollMs);
      return () => clearInterval(id);
    })();
    return () => { alive = false; };
  }, [pollMs]);

  return { count, loading, reload: load } as const;
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const isActive = (href: string) => pathname?.startsWith(href);

  const { counts, loading } = useNavCounts(15000);

  // ===== NUEVO: mesas activas =====
  const { count: activeTables, loading: loadingTables } = useActiveTablesCount(15000);

  const kitch = counts?.kitchenPending ?? 0;
  const cashq = counts?.cashierQueue ?? 0;
  const deliv = counts?.deliveryPending ?? 0;

  return (
    <>
      <nav className="navbar navbar-expand-md navbar-light bg-white border-bottom shadow-sm">
        <div className="container">
          <Link className="navbar-brand fw-semibold" href="/admin">Admin Portal</Link>

          <button
            className="navbar-toggler"
            type="button"
            aria-label="Toggle navigation"
            aria-expanded={open ? 'true' : 'false'}
            onClick={() => setOpen((v) => !v)}
          >
            <span className="navbar-toggler-icon"></span>
          </button>

          <div className={`collapse navbar-collapse${open ? ' show' : ''}`}>
            <ul className="navbar-nav me-auto mb-2 mb-md-0">

              <li className="nav-item">
                <Link className={`nav-link d-flex align-items-center gap-2 ${isActive('/admin/kitchen') ? 'active' : ''}`} href="/admin/kitchen">
                  <span>Kitchen</span>
                  <span className="badge rounded-pill text-bg-primary">
                    {loading && counts == null ? '…' : kitch}
                  </span>
                </Link>
              </li>

              <li className="nav-item">
                <Link className={`nav-link d-flex align-items-center gap-2 ${isActive('/admin/cashier') ? 'active' : ''}`} href="/admin/cashier">
                  <span>Cashier</span>
                  <span className="badge rounded-pill text-bg-success">
                    {loading && counts == null ? '…' : cashq}
                  </span>
                </Link>
              </li>

              <li className="nav-item">
                <Link className={`nav-link d-flex align-items-center gap-2 ${isActive('/admin/delivery') ? 'active' : ''}`} href="/admin/delivery">
                  <span>Delivery</span>
                  <span className="badge rounded-pill text-bg-warning">
                    {loading && counts == null ? '…' : deliv}
                  </span>
                </Link>
              </li>

              <li className="nav-item">
                <Link className={`nav-link d-flex align-items-center gap-2 ${isActive('/admin/waiter') ? 'active' : ''}`} href="/admin/waiter">
                  <span>Tables</span>
                  {/* ===== NUEVO: badge de mesas activas ===== */}
                  <span className="badge rounded-pill text-bg-secondary">
                    {loadingTables && activeTables == null ? '…' : (activeTables ?? 0)}
                  </span>
                </Link>
              </li>

              
            </ul>

            <div className="d-flex align-items-center gap-2">
              <Link className="btn btn-outline-primary btn-sm" href="/logout">Logout</Link>
            </div>
          </div>
        </div>
      </nav>

      <main className="container py-4">{children}</main>
    </>
  );
}
