// src/app/adming/roles/page.tsx
'use client';

import { OnlyAdmin } from "@/components/Only";

import React, { useEffect, useMemo, useState } from 'react';

/* ---- Firebase Auth (cliente) ---- */
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
      console.warn('[Firebase] Faltan variables NEXT_PUBLIC_* para inicializar el cliente.');
    }
  }
}
async function getAuthMod() {
  await ensureFirebaseApp();
  return await import('firebase/auth');
}
async function getIdTokenSafe(forceRefresh = false): Promise<string | null> {
  try {
    const { getAuth } = await getAuthMod();
    const auth = getAuth();
    const u = auth.currentUser;
    if (!u) return null;
    return await u.getIdToken(forceRefresh);
  } catch {
    return null;
  }
}
function useAuthClaims() {
  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState<any | null>(null);
  const [claims, setClaims] = useState<any | null>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      const { onAuthStateChanged, getAuth, getIdTokenResult } = await getAuthMod();
      const auth = getAuth();
      const unsub = onAuthStateChanged(auth, async (u) => {
        if (!alive) return;
        setUser(u ?? null);
        if (u) {
          const res = await getIdTokenResult(u);
          setClaims(res.claims || null);
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
  return { authReady, user, isAdmin: !!claims?.admin } as const;
}

/* ---- API helper ---- */
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

/* ---- Tipos ---- */
type UserRow = {
  uid: string;
  email?: string | null;
  displayName?: string | null;
  disabled: boolean;
  claims: Record<string, any>;
  metadata?: { creationTime?: string; lastSignInTime?: string };
};

/* ✅ Agregamos cashier aquí */
const ROLES: Array<{ key: 'admin' | 'kitchen' | 'waiter' | 'delivery' | 'cashier'; label: string }> = [
  { key: 'admin', label: 'Admin' },
  { key: 'kitchen', label: 'Kitchen' },
  { key: 'waiter', label: 'Waiter' },
  { key: 'delivery', label: 'Delivery' },
  { key: 'cashier', label: 'Cashier' }, // ← NUEVO
];

function RolesPage_Inner() {
  const { authReady, user, isAdmin } = useAuthClaims();

  const [rows, setRows] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = async () => {
    try {
      setErr(null);
      setLoading(true);
      const res = await apiFetch('/api/admin/users?limit=200');
      if (!res.ok) throw new Error(`GET /api/admin/users ${res.status}`);
      const data = await res.json();
      setRows(data.users || []);
    } catch (e: any) {
      setErr(e?.message || 'Error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (user && isAdmin) load();
  }, [user, isAdmin]);

  const onToggle = async (uid: string, role: string, value: boolean) => {
    try {
      const body: any = { [role]: value }; // p.ej. { cashier: true }
      const res = await apiFetch(`/api/admin/users/${uid}/roles`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || `PATCH ${res.status}`);
      }
      await load();
      alert('Roles updated. The user must refresh their session to obtain new permissions.');
    } catch (e: any) {
      alert(e?.message || 'Could not update roles');
    }
  };

  if (!authReady) return <div className="container py-3">Initializing…</div>;
  if (!user) return <div className="container py-3 text-danger">You must sign in.</div>;
  if (!isAdmin) return <div className="container py-3 text-danger">Unauthorized (admins only).</div>;

  return (
    <div className="container py-3">
      <div className="d-flex align-items-center justify-content-between mb-3">
        <h1 className="h4 m-0">Manage roles</h1>
        <button className="btn btn-outline-secondary btn-sm" onClick={load} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {err && <div className="alert alert-danger">{err}</div>}

      <div className="table-responsive">
        <table className="table align-middle">
          <thead>
            <tr>
              <th>User</th>
              <th>UID</th>
              {ROLES.map((r) => (
                <th key={r.key}>{r.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((u) => (
              <tr key={u.uid}>
                <td>
                  <div className="fw-semibold">{u.displayName || u.email || '(no name)'}</div>
                  <div className="text-muted small">{u.email}</div>
                  {u.disabled && <span className="badge bg-warning text-dark">Disabled</span>}
                </td>
                <td className="text-muted small">{u.uid}</td>
                {ROLES.map((r) => {
                  const checked = !!u.claims?.[r.key];
                  return (
                    <td key={r.key}>
                      <input
                        type="checkbox"
                        className="form-check-input"
                        checked={checked}
                        onChange={(e) => onToggle(u.uid, r.key, e.currentTarget.checked)}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={2 + ROLES.length} className="text-muted">
                  No results
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="text-muted small mt-2">
        * The user must sign out and sign back in (or refresh their ID token) to receive the new permissions.
      </div>
    </div>
  );
}


export default function RolesPage() {
  return (
    <OnlyAdmin>
      <RolesPage_Inner />
    </OnlyAdmin>
  );
}
