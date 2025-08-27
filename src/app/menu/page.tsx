'use client';

import React, { useEffect, useState } from 'react';

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
    }
  }
}
async function getFirestoreMod() {
  await ensureFirebaseApp();
  return await import('firebase/firestore');
}

type Category = {
  id: string;
  name: string;
  description?: string;
  isActive?: boolean;
  slug?: string;
  sortOrder?: number;
};

export default function MenuCategoriesPage() {
  const [loading, setLoading] = useState(true);
  const [cats, setCats] = useState<Category[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let unsub: any;
    (async () => {
      try {
        setErr(null);
        const { getFirestore, collection, onSnapshot, query, orderBy } = await getFirestoreMod();
        const db = getFirestore();

        // Suscribimos SOLO con orderBy(sortOrder) y filtramos isActive en cliente.
        // Así NO requiere índice compuesto.
        const q = query(collection(db, 'categories'), orderBy('sortOrder', 'asc'));
        unsub = onSnapshot(
          q,
          (snap) => {
            const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() } as any));
            const active = rows.filter((r) => r.isActive !== false); // filtra aquí
            setCats(active);
            setLoading(false);
          },
          (e) => {
            console.warn('onSnapshot categories error:', e);
            // Fallback sin orderBy (y ordenamos en cliente)
            try { unsub && unsub(); } catch {}
            const unsub2 = onSnapshot(collection(db, 'categories'), (snap2) => {
              const rows = snap2.docs.map((d) => ({ id: d.id, ...d.data() } as any));
              const active = rows.filter((r) => r.isActive !== false);
              active.sort((a: any, b: any) => (a.sortOrder ?? 9999) - (b.sortOrder ?? 9999));
              setCats(active);
              setLoading(false);
            });
            unsub = unsub2;
          }
        );
      } catch (e: any) {
        setErr(e?.message || 'Error cargando categorías');
        setLoading(false);
      }
    })();
    return () => { try { unsub && unsub(); } catch {} };
  }, []);

  if (loading) return <div className="container py-4">Cargando menú…</div>;
  if (err) return <div className="container py-4 text-danger">{err}</div>;

  return (
    <div className="container py-4">
      <h1 className="h4 mb-3">Categorías</h1>
      {cats.length === 0 && <div className="text-muted">No hay categorías activas.</div>}
      <div className="row g-3">
        {cats.map((c) => (
          <div key={c.id} className="col-12 col-sm-6 col-md-4 col-lg-3">
            <a href={`/menu/${c.id}`} className="text-decoration-none text-reset">
              <div className="card h-100">
                <div className="card-body">
                  <div className="fw-semibold">{c.name}</div>
                  {c.description ? <div className="text-muted small mt-1">{c.description}</div> : null}
                </div>
                {typeof c.sortOrder === 'number' ? (
                  <div className="card-footer text-muted small">Orden: {c.sortOrder}</div>
                ) : null}
              </div>
            </a>
          </div>
        ))}
      </div>
    </div>
  );
}
