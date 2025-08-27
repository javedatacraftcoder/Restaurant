'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';

/* ============ Firebase + auth (mínimo) ============ */
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

/* ============ Tipos & utils ============ */
type StatusSnake =
  | 'cart' | 'placed' | 'kitchen_in_progress' | 'kitchen_done'
  | 'ready_to_close' | 'assigned_to_courier' | 'on_the_way'
  | 'delivered' | 'closed' | 'cancelled';

type OrderItemLine = {
  menuItemName: string;
  quantity: number;
  options?: Array<{ groupName: string; selected: Array<any> }>;
  addons?: Array<any>;
  extras?: Array<any>;
  modifiers?: Array<any>;
  unitPriceCents?: number;
  priceCents?: number;
  price?: number;
  totalCents?: number;
};
type Amounts = {
  subtotal?: number;
  serviceFee?: number;
  discount?: number;
  tax?: number;
  tip?: number;
  total?: number;
};
type OrderDoc = {
  id: string;
  orderNumber?: string;
  type?: 'dine_in' | 'delivery';
  status: StatusSnake;
  items?: OrderItemLine[];
  lines?: OrderItemLine[];
  amounts?: Amounts;
  totals?: { totalCents?: number; subtotalCents?: number; taxCents?: number; serviceFeeCents?: number; discountCents?: number };
  tableNumber?: string | null;
  deliveryAddress?: string | null;
  notes?: string | null;
  createdAt?: any;
};

const toNum = (x: any) => { const n = Number(x); return Number.isFinite(n) ? n : undefined; };
const centsToQ = (c?: number) => (Number.isFinite(c) ? Number(c) / 100 : 0);
function fmtCurrency(n?: number, currency = 'GTQ') {
  if (typeof n !== 'number') return '—';
  try { return new Intl.NumberFormat('es-GT', { style: 'currency', currency }).format(n); }
  catch { return n.toFixed(2); }
}
function toDate(x: any): Date {
  if (x?.toDate?.() instanceof Date) return x.toDate();
  const d = new Date(x);
  return isNaN(d.getTime()) ? new Date() : d;
}
function getLineQty(l: any) { return Number(l?.quantity ?? l?.qty ?? 1) || 1; }
function getLineName(l: any) { return String(l?.menuItemName ?? l?.name ?? l?.menuItem?.name ?? 'Ítem'); }
function extractDeltaQ(x: any): number {
  const a = toNum(x?.priceDelta); if (a !== undefined) return a;
  const b = toNum(x?.priceExtra); if (b !== undefined) return b;
  const ac = toNum(x?.priceDeltaCents); if (ac !== undefined) return ac / 100;
  const bc = toNum(x?.priceExtraCents); if (bc !== undefined) return bc / 100;
  const p = toNum(x?.price); if (p !== undefined) return p;
  const pc = toNum(x?.priceCents); if (pc !== undefined) return pc / 100;
  return 0;
}
function unitPriceQ(l: any): number {
  const upc = toNum(l?.unitPriceCents); if (upc !== undefined) return upc / 100;
  const pc = toNum(l?.priceCents); if (pc !== undefined) return pc / 100;
  const p = toNum(l?.price); if (p !== undefined) return p;
  return 0;
}
function perUnitAddonsQ(l: any): number {
  let sum = 0;
  if (Array.isArray(l?.options)) {
    for (const g of l.options) {
      const sel = Array.isArray(g?.selected) ? g.selected : [];
      for (const s of sel) sum += extractDeltaQ(s);
    }
  }
  for (const key of ['addons', 'extras', 'modifiers'] as const) {
    const arr = (l as any)[key];
    if (Array.isArray(arr)) {
      for (const x of arr) {
        if (typeof x === 'string') continue;
        sum += extractDeltaQ(x);
      }
    }
  }
  return sum;
}
function lineTotalQ(l: any): number {
  const qty = getLineQty(l);
  if (Number.isFinite(l?.totalCents)) return Number(l.totalCents) / 100;
  const base = unitPriceQ(l);
  const deltas = perUnitAddonsQ(l);
  return (base + deltas) * qty;
}
function preferredLines(o: OrderDoc): OrderItemLine[] {
  return (Array.isArray(o.items) && o.items.length ? o.items! : (Array.isArray(o.lines) ? o.lines! : [])) as OrderItemLine[];
}
function computeOrderTotalsQ(o: OrderDoc) {
  if (o?.amounts && Number.isFinite(o.amounts.total)) {
    return {
      subtotal: Number(o.amounts.subtotal || 0),
      tax: Number(o.amounts.tax || 0),
      serviceFee: Number(o.amounts.serviceFee || 0),
      discount: Number(o.amounts.discount || 0),
      tip: Number(o.amounts.tip || 0),
      total: Number(o.amounts.total || 0),
    };
  }
  if (o?.totals && Number.isFinite(o.totals.totalCents)) {
    return {
      subtotal: centsToQ(o.totals.subtotalCents),
      tax: centsToQ(o.totals.taxCents),
      serviceFee: centsToQ(o.totals.serviceFeeCents),
      discount: centsToQ(o.totals.discountCents),
      tip: Number(o.amounts?.tip || 0),
      total: centsToQ(o.totals.totalCents) + Number(o.amounts?.tip || 0),
    };
  }
  const lines = preferredLines(o);
  const subtotal = lines.reduce((acc, l) => acc + lineTotalQ(l), 0);
  const tip = Number(o.amounts?.tip || 0);
  return { subtotal, tax: 0, serviceFee: 0, discount: 0, tip, total: subtotal + tip };
}

/* ======= NUEVOS helpers para evitar Q 0.00 en unit/subtotal línea ======= */
function unitWithAddonsQ(l: any, order?: OrderDoc, linesCount?: number): number {
  const qty = getLineQty(l);
  const base = unitPriceQ(l);
  const addons = perUnitAddonsQ(l);

  if ((base ?? 0) > 0 || (addons ?? 0) > 0) return (base || 0) + (addons || 0);

  if (Number.isFinite(l?.totalCents) && qty > 0) {
    return Number(l.totalCents) / 100 / qty;
  }

  const count = Number(linesCount || 0);
  if (order && count === 1 && qty > 0) {
    const subFromAmounts = Number.isFinite(order?.amounts?.subtotal) ? Number(order!.amounts!.subtotal) : undefined;
    const subFromCents = Number.isFinite(order?.totals?.subtotalCents) ? Number(order!.totals!.subtotalCents) / 100 : undefined;
    const sub = (subFromAmounts ?? subFromCents);
    if (Number.isFinite(sub) && (sub as number) > 0) {
      return (sub as number) / qty;
    }
  }
  return 0;
}
function safeLineTotalsQ(l: any, order?: OrderDoc, linesCount?: number) {
  const qty = getLineQty(l);
  const unitWith = unitWithAddonsQ(l, order, linesCount);
  const lineTotal = unitWith * qty;
  return { unitWith, lineTotal, qty };
}

/* ============ Fetch de la orden por id ============ */
async function fetchOrder(id: string): Promise<OrderDoc | null> {
  let res = await apiFetch(`/api/orders/${id}`);
  if (res.ok) {
    const data = await res.json();
    return (data?.order || data) as OrderDoc;
  }
  res = await apiFetch(`/api/orders?id=${encodeURIComponent(id)}&limit=1`);
  if (res.ok) {
    const data = await res.json();
    const list = (data?.items ?? data?.orders ?? []) as OrderDoc[];
    return list?.[0] ?? null;
  }
  return null;
}

/* ============ Página (sin <html>/<body>) ============ */
export default function ReceiptPage() {
  const { id } = useParams<{ id: string }>();
  const [order, setOrder] = useState<OrderDoc | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const o = await fetchOrder(String(id));
        if (!alive) return;
        if (!o) { setError('Orden no encontrada'); return; }
        setOrder(o);
        // Imprimir tras montar
        setTimeout(() => {
          try { window.print(); } catch {}
        }, 150);
      } catch (e: any) {
        if (!alive) return;
        setError(e?.message || 'No se pudo cargar la orden.');
      }
    })();
    return () => { alive = false; };
  }, [id]);

  const type = useMemo(() => (order?.type || (order?.deliveryAddress ? 'delivery' : 'dine_in')), [order]);
  const lines = useMemo(() => (order ? preferredLines(order) : []), [order]);
  const totals = useMemo(() => (order ? computeOrderTotalsQ(order) : null), [order]);

  return (
    <>
      {/* Estilos locales para el ticket */}
      <style>{`
        * { box-sizing: border-box; }
        @media print { .noprint { display: none !important; } }
        .wrap { max-width: 360px; margin: 0 auto; padding: 12px; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Courier New", monospace; }
        h1 { font-size: 14px; margin: 0 0 6px; text-transform: uppercase; }
        .muted { color: #666; font-size: 11px; }
        .row { display: flex; justify-content: space-between; font-size: 12px; }
        .hr { border-top: 1px dashed #999; margin: 8px 0; }
        .item { margin: 6px 0; }
        .item .name { font-weight: 600; }
        .addon { margin-left: 10px; color: #555; font-size: 11px; }
        .tot { font-weight: 700; }
        .center { text-align: center; }
        .btn { display: inline-block; border: 1px solid #ccc; padding: 6px 10px; border-radius: 6px; background: #f7f7f7; cursor: pointer; }
      `}</style>

      <div className="wrap">
        <div className="noprint" style={{ marginBottom: 8 }}>
          <button className="btn" onClick={() => window.print()}>Imprimir</button>
          <button className="btn" onClick={() => window.close?.()} style={{ marginLeft: 8 }}>Cerrar</button>
        </div>

        {!order && !error && <div className="muted">Cargando…</div>}
        {error && <div className="muted">Error: {error}</div>}

        {order && totals && (
          <>
            <h1>{type === 'delivery' ? 'Delivery' : 'Dine-in'}</h1>
            <div className="muted">#{order.orderNumber || order.id} · {toDate(order.createdAt ?? new Date()).toLocaleString()}</div>
            {order.tableNumber ? <div className="muted">Mesa: {order.tableNumber}</div> : null}
            {order.deliveryAddress ? <div className="muted">Entrega: {order.deliveryAddress}</div> : null}
            {order.notes ? <div className="muted">Nota: {order.notes}</div> : null}
            <div className="hr"></div>

            {lines.map((l, idx) => {
              const { unitWith, lineTotal, qty } = safeLineTotalsQ(l, order, lines.length);
              const name = getLineName(l);

              const groupsHtml: React.ReactNode[] = [];
              if (Array.isArray(l?.options)) {
                for (const g of l.options) {
                  const sels = Array.isArray(g?.selected) ? g.selected : [];
                  if (!sels.length) continue;
                  const rows = sels.map((s: any, i:number) => {
                    const nm = s?.name ?? '';
                    const pr = extractDeltaQ(s);
                    return <span key={i}>{nm}{pr ? ` (${fmtCurrency(pr)})` : ''}{i < sels.length - 1 ? ', ' : ''}</span>;
                  });
                  groupsHtml.push(<div className="addon" key={`g${groupsHtml.length}`}>• <b>{g?.groupName ?? 'Opciones'}:</b> {rows}</div>);
                }
              }
              for (const key of ['addons', 'extras', 'modifiers'] as const) {
                const arr = (l as any)[key];
                if (Array.isArray(arr) && arr.length) {
                  const rows = arr.map((x: any, i:number) => {
                    if (typeof x === 'string') return <span key={i}>{x}{i < arr.length - 1 ? ', ' : ''}</span>;
                    const nm = x?.name ?? '';
                    const pr = extractDeltaQ(x);
                    return <span key={i}>{nm}{pr ? ` (${fmtCurrency(pr)})` : ''}{i < arr.length - 1 ? ', ' : ''}</span>;
                  });
                  groupsHtml.push(<div className="addon" key={`b${groupsHtml.length}`}>• <b>{key}:</b> {rows}</div>);
                }
              }

              return (
                <div className="item" key={idx}>
                  <div className="row">
                    <div className="name">{qty} × {name}</div>
                    {unitWith > 0 && <div>{fmtCurrency(unitWith)}</div>}
                  </div>
                  {groupsHtml}
                  {lineTotal > 0 && (
                    <div className="row">
                      <div className="muted">Subtotal línea</div>
                      <div className="muted">{fmtCurrency(lineTotal)}</div>
                    </div>
                  )}
                </div>
              );
            })}

            <div className="hr"></div>
            <div className="row"><div>Subtotal</div><div>{fmtCurrency(totals.subtotal)}</div></div>
            {totals.tax ? <div className="row"><div>Impuestos</div><div>{fmtCurrency(totals.tax)}</div></div> : null}
            {totals.serviceFee ? <div className="row"><div>Servicio</div><div>{fmtCurrency(totals.serviceFee)}</div></div> : null}
            {totals.discount ? <div className="row"><div>Descuento</div><div>-{fmtCurrency(totals.discount)}</div></div> : null}
            {totals.tip ? <div className="row"><div>Propina</div><div>{fmtCurrency(totals.tip)}</div></div> : null}
            <div className="row tot"><div>Total</div><div>{fmtCurrency(totals.total)}</div></div>

            <div className="hr"></div>
            <div className="center muted">¡Gracias por su compra!</div>
          </>
        )}
      </div>
    </>
  );
}
