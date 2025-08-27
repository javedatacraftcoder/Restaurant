'use client';

import React, { use, useEffect, useState } from 'react';

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

type Category = { id: string; name: string; isActive?: boolean; };
type Subcategory = { id: string; name: string; categoryId: string; isActive?: boolean; sortOrder?: number; };

export default function MenuSubcategoriesPage(
  { params }: { params: Promise<{ catId: string }> }
) {
  const { catId } = use(params); // ✅ desempaquetar params con React.use()

  const [cat, setCat] = useState<Category | null>(null);
  const [subs, setSubs] = useState<Subcategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let unsubCat: any, unsubSubs: any;
    (async () => {
      try {
        setErr(null);
        const { getFirestore, doc, onSnapshot, collection, query, orderBy, where } = await getFirestoreMod();
        const db = getFirestore();

        unsubCat = onSnapshot(doc(db, 'categories', catId), (snap) => {
          setCat(snap.exists() ? ({ id: snap.id, ...snap.data() } as any) : null);
        });

        // Consulta con orderBy + fallback sin orderBy si requiere índice
        const q = query(
          collection(db, 'subcategories'),
          where('categoryId', '==', catId),
          orderBy('sortOrder', 'asc')
        );
        unsubSubs = onSnapshot(
          q,
          (snap) => {
            const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() } as any));
            const active = rows.filter((r) => r.isActive !== false);
            setSubs(active);
            setLoading(false);
          },
          (e) => {
            console.warn('onSnapshot subcategories error:', e);
            // Fallback sin orderBy -> ordenamos en cliente
            try { unsubSubs && unsubSubs(); } catch {}
            const unsub2 = onSnapshot(
              query(collection(db, 'subcategories'), where('categoryId', '==', catId)),
              (snap2) => {
                const rows = snap2.docs.map((d) => ({ id: d.id, ...d.data() } as any));
                const active = rows.filter((r) => r.isActive !== false);
                active.sort((a: any, b: any) => (a.sortOrder ?? 9999) - (b.sortOrder ?? 9999));
                setSubs(active);
                setLoading(false);
              }
            );
            unsubSubs = unsub2;
          }
        );
      } catch (e: any) {
        setErr(e?.message || 'Error cargando subcategorías');
        setLoading(false);
      }
    })();

    return () => {
      try { unsubCat && unsubCat(); } catch {}
      try { unsubSubs && unsubSubs(); } catch {}
    };
  }, [catId]);

  if (loading) return <div className="container py-4">Cargando…</div>;
  if (err) return <div className="container py-4 text-danger">{err}</div>;
  if (!cat) return <div className="container py-4">Categoría no encontrada.</div>;

  return (
    <div className="container py-4">
      <div className="d-flex align-items-center mb-3">
        <a href="/menu" className="me-2 text-decoration-none">←</a>
        <h1 className="h5 m-0">{cat.name}</h1>
      </div>
      {subs.length === 0 && <div className="text-muted">No hay subcategorías activas.</div>}

      <div className="row g-3">
        {subs.map((s) => (
          <div key={s.id} className="col-12 col-sm-6 col-md-4 col-lg-3">
            <a href={`/menu/${catId}/${s.id}`} className="text-decoration-none text-reset">
              <div className="card h-100">
                <div className="card-body">
                  <div className="fw-semibold">{s.name}</div>
                </div>
                {typeof s.sortOrder === 'number' ? (
                  <div className="card-footer text-muted small">Orden: {s.sortOrder}</div>
                ) : null}
              </div>
            </a>
          </div>
        ))}
      </div>
    </div>
  );
}
