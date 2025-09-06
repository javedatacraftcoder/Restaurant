// src/app/admin/cashier/receipt/[id]/page.tsx
'use client';

import { OnlyCashier } from "@/components/Only";

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

/* ===== Firestore (solo para leer billing del cliente) ===== */
async function getFirestoreMod() {
  await ensureFirebaseApp();
  return await import('firebase/firestore');
}

/* ============ Tipos & utils ============ */
type StatusSnake =
  | 'cart' | 'placed' | 'kitchen_in_progress' | 'kitchen_done'
  | 'ready_to_close' | 'assigned_to_courier' | 'on_the_way'
  | 'delivered' | 'closed' | 'cancelled';

type OptionItem = { id?: string; name?: string; price?: number; priceCents?: number; priceDelta?: number; priceDeltaCents?: number; priceExtra?: number; priceExtraCents?: number };
type OrderItemLine = {
  menuItemName: string;
  quantity: number;
  optionGroups?: Array<{ groupId?: string; groupName?: string; type?: 'single'|'multiple'; items: OptionItem[] }>;
  options?: Array<{ groupName: string; selected: OptionItem[] }>;
  addons?: Array<any>;
  extras?: Array<any>;
  modifiers?: Array<any>;
  unitPriceCents?: number;
  unitPrice?: number;
  priceCents?: number;
  price?: number;
  basePriceCents?: number;
  basePrice?: number;
  menuItemPriceCents?: number;
  menuItemPrice?: number;
  totalCents?: number;
  menuItem?: { price?: number; priceCents?: number };
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
  totals?: {
    totalCents?: number; subtotalCents?: number; taxCents?: number; serviceFeeCents?: number; discountCents?: number;
    subtotal?: number; deliveryFee?: number; tip?: number; currency?: string;
  };
  orderTotal?: number;

  tableNumber?: string | null;
  deliveryAddress?: string | null;
  notes?: string | null;
  createdAt?: any;

  // checkout (nuevo)
  orderInfo?: {
    type?: 'dine-in' | 'delivery' | 'pickup';
    table?: string;
    notes?: string;
    address?: string;
    phone?: string;
    customerName?: string;
    addressLabel?: 'home' | 'office';
    addressInfo?: { line1?: string; city?: string; country?: string; zip?: string; notes?: string };
    addressNotes?: string;
    deliveryOption?: { title: string; description?: string; price: number } | null;
  } | null;

  // 👇 importante para vincular al customer
  createdBy?: { uid?: string; email?: string | null } | null;
  userEmail?: string | null;            // fallback antiguo
  userEmail_lower?: string | null;      // fallback antiguo
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

/** Precio base c/u del plato (sin addons). Incluye varios fallbacks. */
function baseUnitPriceQ(l: any): number {
  const baseCents = toNum(l?.basePriceCents) ?? toNum(l?.menuItemPriceCents);
  if (baseCents !== undefined) return baseCents / 100;
  const base = toNum(l?.basePrice) ?? toNum(l?.menuItemPrice);
  if (base !== undefined) return base;

  const miCents = toNum(l?.menuItem?.priceCents);
  if (miCents !== undefined) return miCents / 100;
  const mi = toNum(l?.menuItem?.price);
  if (mi !== undefined) return mi;

  const upc = toNum(l?.unitPriceCents);
  if (upc !== undefined) return upc / 100;
  const up = toNum(l?.unitPrice);
  if (up !== undefined) return up;

  const qty = getLineQty(l);
  const totC = toNum(l?.totalCents);
  if (totC !== undefined && qty > 0) {
    const per = totC / 100 / qty;
    const addons = perUnitAddonsQ(l);
    const derived = per - addons;
    return derived > 0 ? derived : 0;
  }

  const pc = toNum(l?.priceCents);
  if (pc !== undefined) return pc / 100;
  const p = toNum(l?.price);
  if (p !== undefined) return p;

  return 0;
}

/** Suma por unidad de addons/opciones. */
function perUnitAddonsQ(l: any): number {
  let sum = 0;
  if (Array.isArray(l?.optionGroups)) {
    for (const g of l.optionGroups) {
      const its = Array.isArray(g?.items) ? g.items : [];
      for (const it of its) sum += extractDeltaQ(it);
    }
  }
  if (Array.isArray(l?.options)) {
    for (const g of l.options) {
      const sels = Array.isArray(g?.selected) ? g.selected : [];
      for (const s of sels) sum += extractDeltaQ(s);
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
function extractDeltaQ(x: any): number {
  const a = toNum(x?.priceDelta); if (a !== undefined) return a;
  const b = toNum(x?.priceExtra); if (b !== undefined) return b;
  const ac = toNum(x?.priceDeltaCents); if (ac !== undefined) return ac / 100;
  const bc = toNum(x?.priceExtraCents); if (bc !== undefined) return bc / 100;
  const p = toNum(x?.price); if (p !== undefined) return p;
  const pc = toNum(x?.priceCents); if (pc !== undefined) return pc / 100;
  return 0;
}
function lineTotalQ(l: any): number {
  const qty = getLineQty(l);
  const base = baseUnitPriceQ(l);
  const deltas = perUnitAddonsQ(l);
  const totC = toNum(l?.totalCents);
  if (totC !== undefined) return totC / 100;
  return (base + deltas) * qty;
}
function preferredLines(o: OrderDoc): OrderItemLine[] {
  return (Array.isArray(o.items) && o.items.length ? o.items! : (Array.isArray(o.lines) ? o.lines! : [])) as OrderItemLine[];
}

function computeOrderTotalsQ(o: OrderDoc) {
  // Checkout nuevo
  if (o?.totals && (o.totals.subtotal !== undefined || o.totals.deliveryFee !== undefined || o.totals.tip !== undefined)) {
    const subtotal = Number(o.totals.subtotal || 0);
    const deliveryFee = Number((o.totals as any).deliveryFee || 0);
    const tip = Number((o.totals as any).tip || 0);
    const total = Number.isFinite(o.orderTotal) ? Number(o.orderTotal) : (subtotal + deliveryFee + tip);
    return { subtotal, tax: 0, serviceFee: 0, discount: 0, tip, deliveryFee, total };
  }
  // amounts
  if (o?.amounts && Number.isFinite(o.amounts.total)) {
    return {
      subtotal: Number(o.amounts.subtotal || 0),
      tax: Number(o.amounts.tax || 0),
      serviceFee: Number(o.amounts.serviceFee || 0),
      discount: Number(o.amounts.discount || 0),
      tip: Number(o.amounts.tip || 0),
      deliveryFee: 0,
      total: Number(o.amounts.total || 0),
    };
  }
  // cents
  if (o?.totals && Number.isFinite(o.totals.totalCents)) {
    return {
      subtotal: centsToQ(o.totals.subtotalCents),
      tax: centsToQ(o.totals.taxCents),
      serviceFee: centsToQ(o.totals.serviceFeeCents),
      discount: centsToQ(o.totals.discountCents),
      tip: Number(o.amounts?.tip || 0),
      deliveryFee: 0,
      total: centsToQ(o.totals.totalCents) + Number(o.amounts?.tip || 0),
    };
  }
  // fallback
  const lines = preferredLines(o);
  const subtotal = lines.reduce((acc, l) => acc + lineTotalQ(l), 0);
  const tip = Number(o.amounts?.tip || 0);
  return { subtotal, tax: 0, serviceFee: 0, discount: 0, tip, deliveryFee: 0, total: subtotal + tip };
}

/* ======= Helpers unit/subtotal ======= */
function safeLineTotalsQ(l: any) {
  const qty = getLineQty(l);
  let baseUnit = baseUnitPriceQ(l);
  const addonsUnit = perUnitAddonsQ(l);

  if (baseUnit === 0) {
    const totC = toNum(l?.totalCents);
    if (totC !== undefined && qty > 0) {
      const per = totC / 100 / qty;
      const derived = per - addonsUnit;
      if (derived > 0) baseUnit = derived;
    }
  }

  const lineTotal = (baseUnit + addonsUnit) * qty;
  return { baseUnit, addonsUnit, lineTotal, qty };
}

/* ======= Dirección completa (sin nota) ======= */
function fullAddressFrom(order: OrderDoc | null | undefined): string | null {
  const ai = order?.orderInfo?.addressInfo;
  if (ai && (ai.line1 || ai.city || ai.country || ai.zip)) {
    const parts: string[] = [];
    if (ai.line1) parts.push(String(ai.line1));
    if (ai.city) parts.push(String(ai.city));
    if (ai.country) parts.push(String(ai.country));
    let full = parts.join(', ');
    if (ai.zip) full = `${full} ${ai.zip}`;
    return full || null;
  }
  return order?.orderInfo?.address || order?.deliveryAddress || null;
}

/* ======= Leer orden por id ======= */
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

/* ======= Leer billing del customer vinculado a la orden ======= */
async function fetchCustomerBillingForOrder(order: OrderDoc) {
  const { getFirestore, doc, getDoc, collection, query, where, limit, getDocs } = await getFirestoreMod();

  // 1) Preferimos UID del creador de la orden
  const uid = order?.createdBy?.uid;
  if (uid) {
    const snap = await getDoc(doc(getFirestore(), 'customers', uid));
    if (snap.exists()) {
      const d: any = snap.data() || {};
      const b = d?.billing || {};
      return { name: b?.name as (string | undefined), taxId: b?.taxId as (string | undefined) };
    }
  }

  // 2) Fallback por email si no hay UID (para órdenes antiguas)
  const email = order?.userEmail || order?.userEmail_lower || order?.createdBy?.email || null;
  if (email) {
    const q = query(
      collection(getFirestore(), 'customers'),
      where('email', '==', String(email)),
      limit(1),
    );
    const qs = await getDocs(q);
    const first = qs.docs[0];
    if (first?.exists()) {
      const d: any = first.data() || {};
      const b = d?.billing || {};
      return { name: b?.name as (string | undefined), taxId: b?.taxId as (string | undefined) };
    }
  }

  return { name: undefined, taxId: undefined };
}

/* ============ Página (sin <html>/<body>) ============ */
function ReceiptPage_Inner() {
  const { id } = useParams<{ id: string }>();
  const [order, setOrder] = useState<OrderDoc | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ➕ estado para facturación
  const [billingName, setBillingName] = useState<string | undefined>(undefined);
  const [billingTaxId, setBillingTaxId] = useState<string | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const o = await fetchOrder(String(id));
        if (!alive) return;
        if (!o) { setError('Orden no encontrada'); return; }
        setOrder(o);

        // ➕ cargar facturación del customer (sin bloquear la impresión)
        fetchCustomerBillingForOrder(o)
          .then((b) => {
            if (!alive) return;
            setBillingName(b?.name);
            setBillingTaxId(b?.taxId);
          })
          .catch(() => { /* silencioso */ });

        setTimeout(() => { try { window.print(); } catch {} }, 150);
      } catch (e: any) {
        if (!alive) return;
        setError(e?.message || 'No se pudo cargar la orden.');
      }
    })();
    return () => { alive = false; };
  }, [id]);

  const type = useMemo(() => {
    const t = order?.orderInfo?.type?.toLowerCase?.();
    if (t === 'delivery') return 'delivery';
    return order?.type || (order?.orderInfo?.address || order?.deliveryAddress ? 'delivery' : 'dine_in');
  }, [order]);

  const lines = useMemo(() => (order ? preferredLines(order) : []), [order]);
  const totals = useMemo(() => (order ? computeOrderTotalsQ(order) : null), [order]);

  // (existente)
  const address = order?.orderInfo?.address || order?.deliveryAddress || null;
  const phone   = order?.orderInfo?.phone || null;
  const table   = order?.orderInfo?.table || order?.tableNumber || null;
  const notes   = order?.orderInfo?.notes || order?.notes || null;

  // (existente) nombre y dirección completa
  const customerName = order?.orderInfo?.customerName || null;
  const fullAddress  = fullAddressFrom(order);

  // Envío mostrado para ticket
  const deliveryFeeShown = useMemo(() => {
    if (!order) return 0;
    const dfFromTotals = Number(((order as any)?.totals?.deliveryFee) ?? 0);
    if (Number.isFinite(dfFromTotals) && dfFromTotals) return dfFromTotals;
    return Number(order.orderInfo?.deliveryOption?.price || 0);
  }, [order]);

  // Gran total mostrado
  const grandTotalShown = useMemo(() => {
    if (!order || !totals) return 0;
    return Number.isFinite(order.orderTotal) ? Number(order.orderTotal) : Number(totals.total || 0);
  }, [order, totals]);

  // ➕ NUEVO: detectar pickup para mostrar identificador
  const rawType = order?.orderInfo?.type?.toLowerCase?.();

  return (
    <>
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
            {/* ➕ Badge "Pickup" agregado sin cambiar el encabezado existente */}
            {rawType === 'pickup' && <div className="muted" style={{ marginTop: 2 }}><span className="badge bg-dark-subtle text-dark">Pickup</span></div>}

            <div className="muted">#{order.orderNumber || order.id} · {toDate(order.createdAt ?? new Date()).toLocaleString()}</div>
            {table ? <div className="muted">Mesa: {table}</div> : null}

            {/* Cliente / entrega / teléfono (existente) */}
            {customerName ? <div className="muted">Cliente: {customerName}</div> : null}
            {fullAddress ? <div className="muted">Entrega: {fullAddress}</div> : (address ? <div className="muted">Entrega: {address}</div> : null)}
            {phone ? <div className="muted">Tel: {phone}</div> : null}

            {/* ➕ Facturación (si existe en customers/{uid}) */}
            {(billingName || billingTaxId) && <div className="hr"></div>}
            {billingName ? <div className="muted">Factura a: {billingName}</div> : null}
            {billingTaxId ? <div className="muted">NIT: {billingTaxId}</div> : null}

            {/* Nota de la ORDEN, no de la dirección */}
            {notes ? <div className="muted">Nota: {notes}</div> : null}

            <div className="hr"></div>

            {lines.map((l, idx) => {
              const { baseUnit, addonsUnit, lineTotal, qty } = safeLineTotalsQ(l);
              const name = getLineName(l);

              const groupsHtml: React.ReactNode[] = [];

              // optionGroups
              if (Array.isArray(l?.optionGroups)) {
                for (const g of l.optionGroups) {
                  const its = Array.isArray(g?.items) ? g.items : [];
                  if (!its.length) continue;
                  const rows = its.map((it: any, i:number) => {
                    const nm = it?.name ?? '';
                    const pr = extractDeltaQ(it);
                    return <span key={i}>{nm}{pr ? ` (${fmtCurrency(pr)})` : ''}{i < its.length - 1 ? ', ' : ''}</span>;
                  });
                  groupsHtml.push(<div className="addon" key={`g${groupsHtml.length}`}>• <b>{g?.groupName ?? 'Opciones'}:</b> {rows}</div>);
                }
              }

              // options legacy
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

              // buckets
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
                    <div>{fmtCurrency(baseUnit)}</div>
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

            {/* ➕ Envío si es delivery */}
            {type === 'delivery' && (
              <div className="row">
                <div>Envío{ order?.orderInfo?.deliveryOption?.title ? ` — ${order.orderInfo.deliveryOption.title}` : '' }</div>
                <div>{fmtCurrency(deliveryFeeShown)}</div>
              </div>
            )}

            {totals.tax ? <div className="row"><div>Impuestos</div><div>{fmtCurrency(totals.tax)}</div></div> : null}
            {totals.serviceFee ? <div className="row"><div>Servicio</div><div>{fmtCurrency(totals.serviceFee)}</div></div> : null}
            {totals.discount ? <div className="row"><div>Descuento</div><div>-{fmtCurrency(totals.discount)}</div></div> : null}

            {/* Propina solo si aplica (normalmente dine-in/pickup) */}
            {Number(totals.tip || 0) > 0 && <div className="row"><div>Propina</div><div>{fmtCurrency(totals.tip)}</div></div>}

            <div className="row tot"><div>Gran total</div><div>{fmtCurrency(grandTotalShown)}</div></div>

            <div className="hr"></div>
            <div className="center muted">¡Gracias por su compra!</div>
          </>
        )}
      </div>
    </>
  );
}

export default function ReceiptPage() {
  return (
    <OnlyCashier>
      <ReceiptPage_Inner />
    </OnlyCashier>
  );
}
