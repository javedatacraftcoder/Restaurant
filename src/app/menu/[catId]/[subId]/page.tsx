'use client';

import React, { useEffect, useMemo, useState, use } from 'react';
import { useCart } from '@/lib/cart/context'; // ✅ ruta canónica del carrito

/* =========================================
   Firebase client boot
========================================= */
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

/* =========================================
   Tipos base
========================================= */
type Category = { id: string; name: string; isActive?: boolean };
type Subcategory = { id: string; name: string; categoryId: string; isActive?: boolean };

type OptionGroup = {
  id: string;
  name: string;
  description?: string;
  minSelect?: number;
  maxSelect?: number; // 1 => radio; >1 => checklist
  required?: boolean;
  isActive?: boolean;
};

type OptionItem = {
  id: string;
  groupId: string;
  name: string;
  price?: number;
  isActive?: boolean;
};

type MenuItem = {
  id: string;
  name: string;
  description?: string;
  price: number;
  imageUrl?: string | null;
  active?: boolean;
  categoryId: string;
  subcategoryId: string;
};

function fmtQ(n?: number) {
  if (!Number.isFinite(Number(n))) return '—';
  try {
    return new Intl.NumberFormat('es-GT', { style: 'currency', currency: 'GTQ' }).format(Number(n));
  } catch {
    return `Q ${Number(n).toFixed(2)}`;
  }
}

/* =========================================
   Helpers fetch a tus APIs existentes
========================================= */
async function apiGet<T = any>(url: string): Promise<T> {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(`GET ${url} -> ${r.status}`);
  return r.json();
}

async function fetchGroups(menuItemId: string): Promise<OptionGroup[]> {
  const data = await apiGet<{ groups: OptionGroup[] }>(`/api/option-groups?menuItemId=${encodeURIComponent(menuItemId)}`);
  return (data?.groups || []).filter((g) => g.isActive !== false);
}
async function fetchOptions(groupId: string): Promise<OptionItem[]> {
  const data = await apiGet<{ items: OptionItem[] }>(`/api/option-items?groupId=${encodeURIComponent(groupId)}`);
  return (data?.items || []).filter((o) => o.isActive !== false);
}

/* =========================================
   Página de Platos
========================================= */
export default function MenuItemsPage({ params }: { params: Promise<{ catId: string; subId: string }> }) {
  // ✅ Usamos use(params) para desempaquetar
  const { catId, subId } = use(params);

  const [cat, setCat] = useState<Category | null>(null);
  const [subcat, setSubcat] = useState<Subcategory | null>(null);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // Cache de grupos por item y opciones por grupo
  const [groupsByItem, setGroupsByItem] = useState<Record<string, OptionGroup[]>>({});
  const [optionsByGroup, setOptionsByGroup] = useState<Record<string, OptionItem[]>>({});

  // Selecciones: itemId -> groupId -> optionItemIds[]
  const [selByItem, setSelByItem] = useState<Record<string, Record<string, string[]>>>({});

  // carrito
  const { add } = useCart();

  useEffect(() => {
    let unsubCat: any, unsubSub: any, unsubItems: any;
    (async () => {
      try {
        setErr(null);
        const { getFirestore, doc, onSnapshot, collection, query, where } = await getFirestoreMod();
        const db = getFirestore();

        unsubCat = onSnapshot(doc(db, 'categories', catId), (snap) => {
          setCat(snap.exists() ? ({ id: snap.id, ...snap.data() } as any) : null);
        });

        unsubSub = onSnapshot(doc(db, 'subcategories', subId), (snap) => {
          setSubcat(snap.exists() ? ({ id: snap.id, ...snap.data() } as any) : null);
        });

        unsubItems = onSnapshot(
          query(collection(db, 'menuItems'), where('categoryId', '==', catId), where('subcategoryId', '==', subId)),
          (snap) => {
            const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() } as any));
            const active = rows.filter((r) => r.active !== false);
            active.sort((a: any, b: any) => String(a?.name || '').localeCompare(String(b?.name || '')));
            setItems(active);
            setLoading(false);

            // precargar grupos de cada item
            active.forEach(async (mi) => {
              if (!groupsByItem[mi.id]) {
                try {
                  const gs = await fetchGroups(mi.id);
                  setGroupsByItem((prev) => ({ ...prev, [mi.id]: gs }));
                  for (const g of gs) {
                    if (!optionsByGroup[g.id]) {
                      const opts = await fetchOptions(g.id);
                      setOptionsByGroup((prev) => ({ ...prev, [g.id]: opts }));
                    }
                  }
                } catch {}
              }
            });
          }
        );
      } catch (e: any) {
        setErr(e?.message || 'Error cargando platos');
        setLoading(false);
      }
    })();

    return () => {
      try {
        unsubCat && unsubCat();
      } catch {}
      try {
        unsubSub && unsubSub();
      } catch {}
      try {
        unsubItems && unsubItems();
      } catch {}
    };
  }, [catId, subId]);

  /* =========================================
     Selección de opciones (UI)
  ========================================= */
  function toggleSelection(itemId: string, group: OptionGroup, optionId: string) {
    setSelByItem((prev) => {
      const byGroup = { ...(prev[itemId] || {}) };
      const current = new Set(byGroup[group.id] || []);

      const max = Number(group.maxSelect ?? 0);
      if (max === 1) {
        byGroup[group.id] = [optionId];
      } else {
        if (current.has(optionId)) current.delete(optionId);
        else current.add(optionId);

        if (max > 1 && current.size > max) {
          for (const v of current) {
            if (current.size <= max) break;
            current.delete(v);
          }
        }
        byGroup[group.id] = Array.from(current);
      }
      return { ...prev, [itemId]: byGroup };
    });
  }

  // autocompletar requeridos
  function ensureRequiredForItem(itemId: string): { groupId: string; optionItemIds: string[] }[] {
    const groups = groupsByItem[itemId] || [];
    const current = selByItem[itemId] || {};
    const result: { groupId: string; optionItemIds: string[] }[] = [];

    for (const g of groups) {
      const min = Number(g.minSelect ?? 0);
      const required = g.required || min >= 1;
      const chosen = Array.isArray(current[g.id]) ? current[g.id] : [];
      if (required && (!chosen || chosen.length < Math.max(1, min))) {
        const opts = (optionsByGroup[g.id] || []).slice().sort((a, b) => Number(a.price || 0) - Number(b.price || 0));
        const pick = opts.length ? [opts[0].id] : [];
        result.push({ groupId: g.id, optionItemIds: pick });
      } else if (chosen?.length) {
        result.push({ groupId: g.id, optionItemIds: chosen });
      }
    }
    for (const g of groups) {
      if (result.find((r) => r.groupId === g.id)) continue;
      const chosen = Array.isArray(current[g.id]) ? current[g.id] : [];
      if (chosen.length) result.push({ groupId: g.id, optionItemIds: chosen });
    }
    return result;
  }

  function unitPrice(mi: MenuItem): number {
    const groups = groupsByItem[mi.id] || [];
    const current = selByItem[mi.id] || {};
    let extras = 0;
    for (const g of groups) {
      const chosen = current[g.id] || [];
      const opts = optionsByGroup[g.id] || [];
      const map = new Map(opts.map((o) => [o.id, o]));
      for (const oid of chosen) {
        const op = map.get(oid);
        if (op?.price) extras += Number(op.price) || 0;
      }
    }
    return Number(mi.price || 0) + extras;
  }

  const heading = useMemo(() => {
    if (!cat || !subcat) return 'Platos';
    return `${cat.name} — ${subcat.name}`;
  }, [cat, subcat]);

  function onAddToCart(mi: MenuItem) {
    const selections = ensureRequiredForItem(mi.id);
    add({
      menuItemId: mi.id,
      menuItemName: mi.name,
      quantity: 1,
      selections,
    });
  }

  if (loading) return <div className="container py-4">Cargando…</div>;
  if (err) return <div className="container py-4 text-danger">{err}</div>;
  if (!cat || !subcat) return <div className="container py-4">No encontrado.</div>;

  return (
    <div className="container py-4">
      <div className="d-flex align-items-center mb-3">
        <a href={`/menu/${catId}`} className="me-2 text-decoration-none">←</a>
        <h1 className="h5 m-0">{heading}</h1>
      </div>

      {items.length === 0 && <div className="text-muted">No hay platos en esta subcategoría.</div>}

      <div className="row g-3">
        {items.map((mi) => {
          const groups = groupsByItem[mi.id] || [];
          const sel = selByItem[mi.id] || {};
          const uprice = unitPrice(mi);

          return (
            <div key={mi.id} className="col-12 col-md-6">
              <div className="card h-100">
                {mi.imageUrl ? (
                  <img src={mi.imageUrl} alt={mi.name} style={{ width: '100%', height: 180, objectFit: 'cover' }} />
                ) : null}
                <div className="card-body">
                  <div className="d-flex justify-content-between">
                    <div className="fw-semibold">{mi.name}</div>
                    <div className="fw-semibold">{fmtQ(mi.price)}</div>
                  </div>
                  {mi.description ? <div className="text-muted small mt-1">{mi.description}</div> : null}

                  {!!groups.length && (
                    <div className="mt-3 d-flex flex-column gap-2">
                      {groups.map((g) => {
                        const opts = optionsByGroup[g.id] || [];
                        const max = Number(g.maxSelect ?? 0);
                        const current = new Set(sel[g.id] || []);
                        return (
                          <div key={g.id} className="border rounded p-2">
                            <div className="fw-semibold small">
                              {g.name}
                              {g.required || (g.minSelect ?? 0) > 0 ? <span className="badge text-bg-light ms-2">requerido</span> : null}
                              {max === 1 ? (
                                <span className="badge text-bg-secondary ms-2">uno</span>
                              ) : max > 1 ? (
                                <span className="badge text-bg-secondary ms-2">máx {max}</span>
                              ) : null}
                            </div>
                            <div className="mt-1 d-flex flex-column gap-1">
                              {opts.map((o) => (
                                <label key={o.id} className="form-check d-flex align-items-center">
                                  <input
                                    className="form-check-input me-2"
                                    type={max === 1 ? 'radio' : 'checkbox'}
                                    name={`g_${mi.id}_${g.id}`}
                                    checked={current.has(o.id)}
                                    onChange={() => toggleSelection(mi.id, g, o.id)}
                                  />
                                  <span className="me-auto">{o.name}</span>
                                  {Number.isFinite(Number(o.price)) && <span className="text-muted small">{fmtQ(o.price)}</span>}
                                </label>
                              ))}
                              {!opts.length && <div className="text-muted small">No hay opciones activas.</div>}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
                <div className="card-footer d-flex justify-content-between align-items-center">
                  <div className="text-muted small">
                    Total unitario: <span className="fw-semibold">{fmtQ(uprice)}</span>
                  </div>
                  <button className="btn btn-primary btn-sm" onClick={() => onAddToCart(mi)}>
                    Agregar al carrito
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-4 d-flex gap-2">
        <a className="btn btn-outline-secondary" href={`/menu/${catId}`}>Volver</a>
        <a className="btn btn-success" href="/checkout">Ir al checkout</a>
      </div>
    </div>
  );
}
