/* src/app/(client)/app/page.tsx */
'use client';

import React, { useEffect, useMemo, useState } from 'react';
import '@/lib/firebase/client';
import { getFirestore, collection, getDocs, query, where } from 'firebase/firestore';

type PromoDoc = {
  id: string;
  name?: string;
  title?: string;
  code?: string;
  active?: boolean;
  startAt?: any;
  endAt?: any;
};

function toDateMaybe(x: any): Date | null {
  if (!x) return null;
  if (typeof x?.toDate === 'function') {
    try { return x.toDate(); } catch { /* ignore */ }
  }
  const d = new Date(x);
  return isNaN(d.getTime()) ? null : d;
}

/** Normaliza cualquier cosa a arreglo */
function normalizeList<T = any>(x: unknown): T[] {
  if (Array.isArray(x)) return x as T[];
  if (x && typeof x === 'object') return Object.values(x as Record<string, T>);
  return [];
}

/** 🔁 Dedupe por ID de documento (no por código) */
function uniqById(list: PromoDoc[]): PromoDoc[] {
  const seen = new Set<string>();
  const out: PromoDoc[] = [];
  for (const p of list) {
    const k = String(p.id || p.code || '');
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(p);
  }
  return out;
}

export default function AppHome() {
  const [promos, setPromos] = useState<PromoDoc[]>([]);
  const [loadingPromos, setLoadingPromos] = useState<boolean>(true);

  useEffect(() => {
    let alive = true;

    async function load() {
      try {
        let acc: PromoDoc[] = [];
        const now = new Date();

        // 1) Endpoint público (si existe)
        try {
          const res = await fetch('/api/promotions/public', { cache: 'no-store' });
          if (res.ok) {
            const j = await res.json().catch(() => ({}));
            const arr = normalizeList<any>(j?.items ?? j?.promotions ?? []);
            const filtered = arr
              .filter((p) => {
                const active = p?.active !== false;
                const start = toDateMaybe(p?.startAt);
                const end = toDateMaybe(p?.endAt);
                return active && (!start || now >= start) && (!end || now <= end) && p?.code;
              })
              .map((p) => ({
                id: p.id || p.promoId || p.code,   // el endpoint debe enviar id del doc
                name: p.name,
                title: p.title,
                code: p.code,
              })) as PromoDoc[];
            acc = acc.concat(filtered);
          }
        } catch { /* silent */ }

        // 2) Fallback Firestore
        try {
          const db = getFirestore();
          const qRef = query(collection(db, 'promotions'), where('active', '==', true));
          const snap = await getDocs(qRef);
          const arr = snap.docs
            .map((d) => {
              const data = d.data() as any;
              return {
                id: d.id,
                name: data?.name,
                title: data?.title,
                code: data?.code,
                active: data?.active !== false,
                startAt: data?.startAt,
                endAt: data?.endAt,
              } as PromoDoc;
            })
            .filter((p) => {
              const start = toDateMaybe(p.startAt);
              const end = toDateMaybe(p.endAt);
              return p.active !== false && (!start || now >= start) && (!end || now <= end) && p.code;
            });

          acc = acc.concat(arr);
        } catch { /* silent */ }

        // 3) Dedupe por ID (para no perder promos con el mismo código)
        if (alive) {
          const deduped = uniqById(acc);
          setPromos(deduped);
          setLoadingPromos(false);
        }
      } catch {
        if (alive) setLoadingPromos(false);
      }
    }

    load();
    return () => { alive = false; };
  }, []);

  const hasPromos = useMemo(() => promos.length > 0, [promos]);

  return (
    <section className="container py-4">
      <div className="row gy-4">
        {/* Hero */}
        <div className="col-12">
          <div className="text-center">
            <h1 className="display-6 fw-semibold mb-2">Welcome!</h1>
            <p className="lead text-body-secondary">
              Start by viewing the <a className="link-primary" href="/app/menu">menu</a> or check your{" "}
              <a className="link-secondary" href="/app/orders">order history</a>.
            </p>

            <div className="d-flex flex-wrap justify-content-center gap-2 mt-3">
              <a href="/app/menu" className="btn btn-primary btn-lg" aria-label="View menu">
                View menu
              </a>
              <a href="/app/orders" className="btn btn-outline-secondary btn-lg" aria-label="View my orders">
                My orders
              </a>
            </div>
          </div>
        </div>

        {/* Accesos rápidos */}
        <div className="col-12 col-md-6">
          <div className="card shadow-sm h-100">
            <div className="card-body">
              <h2 className="h5 mb-3">Quick links</h2>
              <div className="d-grid gap-2">
                <a className="btn btn-light" href="/app/cart" aria-label="View cart">🛒 View cart</a>
                <a className="btn btn-light" href="/app/checkout" aria-label="Go to checkout">💳 Go to checkout</a>
                <a className="btn btn-light" href="/app/user-config" aria-label="Go to settings">⚙️ Settings</a>
              </div>
            </div>
          </div>
        </div>

        {/* Seguimiento / ayuda + Promociones */}
        <div className="col-12 col-md-6">
          <div className="card shadow-sm h-100">
            <div className="card-body">
              <h2 className="h5 mb-3">Order tracking</h2>
              <p className="mb-2 text-body-secondary">
                Check the status of your latest order in real time.
              </p>
              <a className="btn btn-outline-primary" href="/app/tracking" aria-label="Ver seguimiento">
                View tracking
              </a>

              <hr className="my-4" />

              {/* ======= Promociones ======= */}
              <h3 className="h6 text-body-secondary mb-2">Promotions</h3>

              <div
                className="rounded-4 p-3 p-md-4 text-white"
                style={{ background: 'linear-gradient(135deg, #6f42c1, #d63384)' }}
              >
                <div className="d-flex align-items-center justify-content-between mb-3">
                  <div>
                    <div className="fs-5 fw-bold">Active codes</div>
                    <div className="small" style={{ opacity: 0.85 }}>
                      Redeem them at checkout to get your discount
                    </div>
                  </div>
                  <div className="display-6" aria-hidden>🎟️</div>
                </div>

                {loadingPromos && <div className="opacity-75">Loading promotions…</div>}

                {!loadingPromos && hasPromos && (
                  <div className="d-flex flex-wrap gap-2">
                    {promos.map((p, idx) => (
                      <div
                        key={(p.id || p.code || 'promo') + ':' + idx}
                        className="bg-white text-dark rounded-pill px-3 py-2 shadow-sm d-inline-flex align-items-center"
                        style={{ border: '1px solid rgba(0,0,0,.06)' }}
                      >
                        <div className="me-2">
                          <span className="fw-semibold">{p.name || p.title || 'Promotion'}</span>
                        </div>
                        <span className="badge bg-dark-subtle text-dark border">{p.code}</span>
                        <button
                          className="btn btn-sm btn-dark ms-2"
                          onClick={() => navigator.clipboard?.writeText(p.code || '')}
                          aria-label={`Copy code ${p.code}`}
                          title="Copy code"
                          type="button"
                        >
                          Copy
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {!loadingPromos && !hasPromos && (
                  <div className="opacity-75">There are no active promotions at the moment.</div>
                )}
              </div>
              {/* ======= FIN Promociones ======= */}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
