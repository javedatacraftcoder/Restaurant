// src/app/admin/cashier/page.tsx

'use client';

import { OnlyCashier } from "@/components/Only";

import React, { useEffect, useMemo, useRef, useState } from 'react';

/* ===================================================
   Firebase (client) — igual que en OPS, sin tocar nada
=================================================== */
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
    } else {
      console.warn('[Firebase] Faltan variables NEXT_PUBLIC_*; Auth no podrá inicializar.');
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
async function getIdTokenResultSafe(): Promise<{ token: string; claims: any } | null> {
  try {
    const { getAuth, getIdTokenResult } = await getAuthMod();
    const auth = getAuth();
    const user = auth.currentUser;
    if (!user) return null;
    const res = await getIdTokenResult(user, false);
    return { token: res.token, claims: res.claims };
  } catch {
    return null;
  }
}
function useAuthState() {
  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState<any | null>(null);
  useEffect(() => {
    let mounted = true;
    (async () => {
      const { onAuthStateChanged, getAuth } = await getAuthMod();
      const auth = getAuth();
      const unsub = onAuthStateChanged(auth, (u) => {
        if (!mounted) return;
        setUser(u ?? null);
        setAuthReady(true);
      });
      return () => unsub();
    })();
    return () => { mounted = false; };
  }, []);
  return { authReady, user } as const;
}
function useAuthClaims() {
  const { authReady, user } = useAuthState();
  const [claims, setClaims] = useState<any | null>(null);
  useEffect(() => {
    let mounted = true;
    (async () => {
      if (!user) { setClaims(null); return; }
      const res = await getIdTokenResultSafe();
      if (mounted) setClaims(res?.claims ?? null);
    })();
    return () => { mounted = false; };
  }, [user]);
  const flags = useMemo(() => ({
    isAdmin: !!claims?.admin,
    isKitchen: !!claims?.kitchen || !!claims?.admin,
    isCashier: !!claims?.cashier || !!claims?.admin,
    isDelivery: !!claims?.delivery || !!claims?.admin,
    isWaiter: !!claims?.waiter || !!claims?.admin,
  }), [claims]);
  return { authReady, user, claims, ...flags } as const;
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

/* ===================================================
   Types & Utils
=================================================== */
type StatusSnake =
  | 'cart'
  | 'placed'
  | 'kitchen_in_progress'
  | 'kitchen_done'
  | 'ready_to_close'
  | 'assigned_to_courier'
  | 'on_the_way'
  | 'delivered'
  | 'closed'
  | 'cancelled';

type OptionItem = { id?: string; name?: string; price?: number; priceCents?: number; priceDelta?: number; priceDeltaCents?: number; priceExtra?: number; priceExtraCents?: number };
type OrderItemLine = {
  menuItemName: string;
  quantity: number;

  // NUEVO: optionGroups desde Checkout (además de legacy options)
  optionGroups?: Array<{ groupId?: string; groupName?: string; type?: 'single' | 'multiple'; items: OptionItem[] }>;

  options?: Array<{ groupName: string; selected: OptionItem[] }>;
  addons?: Array<string | OptionItem>;
  extras?: Array<string | OptionItem>;
  modifiers?: Array<string | OptionItem>;
  unitPriceCents?: number;
  unitPrice?: number;
  priceCents?: number;
  price?: number;
  basePriceCents?: number;
  basePrice?: number;
  menuItemPriceCents?: number;
  menuItemPrice?: number;
  totalCents?: number;

  // opcional por compat
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
  totals?: { totalCents?: number; subtotalCents?: number; taxCents?: number; serviceFeeCents?: number; discountCents?: number };
  tableNumber?: string | null;
  deliveryAddress?: string | null;
  notes?: string | null;
  createdAt?: any;

  // Además puede venir orderInfo desde Checkout
  orderInfo?: { type?: 'dine-in' | 'delivery'; table?: string; notes?: string; address?: string; phone?: string } | null;
};

const TitleMap: Record<StatusSnake, string> = {
  cart: 'Carrito',
  placed: 'Recibido',
  kitchen_in_progress: 'En cocina',
  kitchen_done: 'Cocina lista',
  ready_to_close: 'Listo para cerrar',
  assigned_to_courier: 'Asignado a repartidor',
  on_the_way: 'En camino',
  delivered: 'Entregado',
  closed: 'Cerrado',
  cancelled: 'Cancelado',
};

function toDate(x: any): Date {
  if (x?.toDate?.() instanceof Date) return x.toDate();
  const d = new Date(x);
  return isNaN(d.getTime()) ? new Date() : d;
}
function fmtCurrency(n?: number, currency = 'GTQ') {
  if (typeof n !== 'number') return '—';
  try {
    return new Intl.NumberFormat('es-GT', { style: 'currency', currency }).format(n);
  } catch {
    return n.toFixed(2);
  }
}
const toNum = (x: any) => {
  const n = Number(x);
  return Number.isFinite(n) ? n : undefined;
};
const centsToQ = (c?: number) => (Number.isFinite(c) ? (Number(c) / 100) : 0);

/* ===================================================
   Flujos y helpers de transición (cierre encadenado)
=================================================== */
const FLOW_DINE_IN: StatusSnake[] = ['placed', 'kitchen_in_progress', 'kitchen_done', 'ready_to_close', 'closed'];
const FLOW_DELIVERY: StatusSnake[] = ['placed', 'kitchen_in_progress', 'kitchen_done', 'assigned_to_courier', 'on_the_way', 'delivered', 'closed'];

function flowFor(type: 'dine_in' | 'delivery') {
  return type === 'delivery' ? FLOW_DELIVERY : FLOW_DINE_IN;
}
function nextAllowed(type: 'dine_in' | 'delivery', from: StatusSnake): StatusSnake | null {
  const f = flowFor(type);
  const i = f.indexOf(from);
  return i >= 0 && i < f.length - 1 ? f[i + 1] : null;
}
async function changeStatus(orderId: string, to: StatusSnake) {
  const key = `${orderId}:${to}:${Date.now()}`;
  const res = await apiFetch(`/api/orders/${orderId}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': key },
    body: JSON.stringify({ nextStatus: to }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.error || `Status ${res.status}`);
  }
  return res.json();
}
async function advanceToClose(order: OrderDoc, onStep?: (s: StatusSnake) => Promise<void>) {
  const type = (order.orderInfo?.type?.toLowerCase?.() === 'delivery')
    ? 'delivery'
    : (order.type || (order.deliveryAddress ? 'delivery' : 'dine_in'));
  let cur = order.status;
  while (cur !== 'closed') {
    const nx = nextAllowed(type, cur);
    if (!nx) break;
    if (onStep) await onStep(nx);
    await changeStatus(order.id, nx);
    cur = nx;
  }
}

/* ===================================================
   Cálculo de totales y líneas (con addons + deltas)
=================================================== */
function getLineQty(l: any) { return Number(l?.quantity ?? l?.qty ?? 1) || 1; }
function getLineName(l: any) { return String(l?.menuItemName ?? l?.name ?? l?.menuItem?.name ?? 'Ítem'); }

/** Precio base c/u del plato (sin addons). Incluye varios fallbacks. */
function baseUnitPriceQ(l: any): number {
  // Preferir campos "base"
  const baseCents = toNum(l?.basePriceCents) ?? toNum(l?.menuItemPriceCents);
  if (baseCents !== undefined) return baseCents / 100;
  const base = toNum(l?.basePrice) ?? toNum(l?.menuItemPrice);
  if (base !== undefined) return base;

  // Fallback: menuItem?.price
  const miCents = toNum(l?.menuItem?.priceCents);
  if (miCents !== undefined) return miCents / 100;
  const mi = toNum(l?.menuItem?.price);
  if (mi !== undefined) return mi;

  // Compat: unitPrice* suele ser base en algunos flujos
  const upc = toNum(l?.unitPriceCents);
  if (upc !== undefined) return upc / 100;
  const up = toNum(l?.unitPrice);
  if (up !== undefined) return up;

  // Si solo tenemos totalCents y addons, derivar base (= total/qty - addons)
  const qty = getLineQty(l);
  const totC = toNum(l?.totalCents);
  if (totC !== undefined && qty > 0) {
    const per = totC / 100 / qty;
    const addons = perUnitAddonsQ(l);
    const derived = per - addons;
    return derived > 0 ? derived : 0;
  }

  // Último fallback: price/priceCents (si en tu payload representan base)
  const pc = toNum(l?.priceCents);
  if (pc !== undefined) return pc / 100;
  const p = toNum(l?.price);
  if (p !== undefined) return p;

  return 0;
}

/** Suma por unidad de todos los addons/opciones. */
function perUnitAddonsQ(l: any): number {
  let sum = 0;

  // 0) Checkout nuevo: optionGroups[].items[] (cada item con delta)
  if (Array.isArray(l?.optionGroups)) {
    for (const g of l.optionGroups) {
      const its = Array.isArray(g?.items) ? g.items : [];
      for (const it of its) sum += extractDeltaQ(it);
    }
  }

  // 1) Legacy: options[].selected[]
  if (Array.isArray(l?.options)) {
    for (const g of l.options) {
      const sel = Array.isArray(g?.selected) ? g.selected : [];
      for (const s of sel) sum += extractDeltaQ(s);
    }
  }

  // 2) Buckets: addons/extras/modifiers
  for (const key of ['addons', 'extras', 'modifiers'] as const) {
    const arr = l?.[key];
    if (Array.isArray(arr)) {
      for (const x of arr) {
        if (typeof x === 'string') continue; // sin precio
        sum += extractDeltaQ(x);
      }
    }
  }
  return sum;
}

function extractDeltaQ(x: any): number {
  // soporta priceDelta, priceExtra, priceDeltaCents, priceExtraCents, price/priceCents
  const a = toNum(x?.priceDelta);
  if (a !== undefined) return a;
  const b = toNum(x?.priceExtra);
  if (b !== undefined) return b;
  const ac = toNum(x?.priceDeltaCents);
  if (ac !== undefined) return ac / 100;
  const bc = toNum(x?.priceExtraCents);
  if (bc !== undefined) return bc / 100;
  const p = toNum(x?.price);
  if (p !== undefined) return p;
  const pc = toNum(x?.priceCents);
  if (pc !== undefined) return pc / 100;
  return 0;
}

function lineTotalQ(l: any): number {
  const qty = getLineQty(l);
  const totC = toNum(l?.totalCents);
  if (totC !== undefined) return totC / 100;
  const base = baseUnitPriceQ(l);
  const deltas = perUnitAddonsQ(l);
  return (base + deltas) * qty;
}
function preferredLines(o: OrderDoc): OrderItemLine[] {
  return (Array.isArray(o.items) && o.items.length ? o.items! : (Array.isArray(o.lines) ? o.lines! : [])) as OrderItemLine[];
}
function computeOrderTotalsQ(o: OrderDoc) {
  // 1) amounts directo
  if (o?.amounts && Number.isFinite(o.amounts.total)) return {
    subtotal: Number(o.amounts.subtotal || 0),
    tax: Number(o.amounts.tax || 0),
    serviceFee: Number(o.amounts.serviceFee || 0),
    discount: Number(o.amounts.discount || 0),
    tip: Number(o.amounts.tip || 0),
    total: Number(o.amounts.total || 0),
  };
  // 2) cents → Q
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
  // 3) fallback sumando líneas
  const lines = preferredLines(o);
  const subtotal = lines.reduce((acc, l) => acc + lineTotalQ(l), 0);
  const tip = Number(o.amounts?.tip || 0);
  return { subtotal, tax: 0, serviceFee: 0, discount: 0, tip, total: subtotal + tip };
}

/* ======= Helpers para mostrar precio unitario/subtotal línea ======= */
function safeLineTotalsQ(l: any, order?: OrderDoc, linesCount?: number) {
  const qty = getLineQty(l);
  let baseUnit = baseUnitPriceQ(l);
  const addonsUnit = perUnitAddonsQ(l);

  // Si no tenemos base pero sí totalCents, derivar base = total/qty - addons
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

/* ===================================================
   Data fetching de órdenes (solo kitchen_done → …)
=================================================== */
const STATUS_IN = [
  'kitchen_done',
  'ready_to_close',
  'assigned_to_courier',
  'on_the_way',
  'delivered',
].join(',');
const TYPE_IN = ['dine_in', 'delivery'].join(',');

function useCashierOrders(enabled: boolean, pollMs = 5000) {
  const [orders, setOrders] = useState<OrderDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<any>(null);

  const fetchNow = async () => {
    try {
      setError(null);
      if (!enabled) { setLoading(false); return; }
      const token = await getIdTokenSafe(false);
      if (!token) { setLoading(false); setError('Debes iniciar sesión.'); return; }

      const url = `/api/orders?statusIn=${encodeURIComponent(STATUS_IN)}&typeIn=${encodeURIComponent(TYPE_IN)}&limit=100`;
      const res = await apiFetch(url);
      if (!res.ok) throw new Error(`GET /orders ${res.status}`);
      const data = await res.json();
      const list: OrderDoc[] = ((data.items ?? data.orders) || []).filter((o: any) =>
        o.status !== 'closed' && o.status !== 'cancelled'
      );
      setOrders(list);
      setLoading(false);
    } catch (e: any) {
      setError(e?.message || 'Error');
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchNow();
    return () => timer.current && clearInterval(timer.current);
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    timer.current = setInterval(fetchNow, pollMs);
    return () => timer.current && clearInterval(timer.current);
  }, [enabled, pollMs]);

  return { orders, loading, error, refresh: fetchNow } as const;
}

/* ===================================================
   Tarjeta (estilo OPS) + botones de Caja
=================================================== */
function BadgeStatus({ s }: { s: StatusSnake }) {
  const map: Record<StatusSnake, string> = {
    placed: 'bg-primary',
    kitchen_in_progress: 'bg-warning text-dark',
    kitchen_done: 'bg-secondary',
    ready_to_close: 'bg-success',
    assigned_to_courier: 'bg-info text-dark',
    on_the_way: 'bg-info text-dark',
    delivered: 'bg-success',
    closed: 'bg-dark',
    cancelled: 'bg-danger',
    cart: 'bg-light text-dark',
  };
  const cls = `badge ${map[s] || 'bg-light text-dark'}`;
  return <span className={cls}>{TitleMap[s] || s}</span>;
}

function OrderCard({
  o,
  onClose,
  busy,
}: {
  o: OrderDoc;
  onClose: (o: OrderDoc) => Promise<void>;
  busy: boolean;
}) {
  const created = toDate(o.createdAt ?? new Date());
  const totals = computeOrderTotalsQ(o);
  const type = (o.orderInfo?.type?.toLowerCase?.() === 'delivery')
    ? 'delivery'
    : (o.type || (o.deliveryAddress ? 'delivery' : 'dine_in'));
  const lines = preferredLines(o);

  return (
    <div className="card shadow-sm">
      <div className="card-header d-flex align-items-center justify-content-between">
        <div className="d-flex flex-column">
          <div className="fw-semibold">#{o.orderNumber || o.id}</div>
          {(type === 'dine_in' && (o.orderInfo?.table || o.tableNumber)) && (
            <div className="fw-semibold">Mesa {o.orderInfo?.table || o.tableNumber}</div>
          )}
          <small className="text-muted">
            {created.toLocaleString()}
          </small>
        </div>
        <div className="d-flex gap-2 align-items-center">
          <span className="badge bg-outline-secondary text-dark">{type}</span>
          <BadgeStatus s={o.status} />
        </div>
      </div>
      <div className="card-body">
        {type === 'delivery' && (o.orderInfo?.address || o.deliveryAddress) ? (
          <div className="mb-1"><strong>Entrega:</strong> {o.orderInfo?.address || o.deliveryAddress}</div>
        ) : null}
        {o.orderInfo?.phone ? <div className="mb-1"><strong>Tel:</strong> {o.orderInfo.phone}</div> : null}
        {(o.orderInfo?.notes || o.notes) ? <div className="mb-2"><em>Nota: {o.orderInfo?.notes || o.notes}</em></div> : null}

        {/* Ítems y addons (con precios por línea) */}
        <div className="mb-2">
          {lines.map((l, idx) => {
            const { baseUnit, addonsUnit, lineTotal, qty } = safeLineTotalsQ(l, o, lines.length);
            const name = getLineName(l);

            const groupRows: React.ReactNode[] = [];

            // A) optionGroups (Checkout nuevo)
            if (Array.isArray(l?.optionGroups)) {
              for (const g of l.optionGroups) {
                const its = Array.isArray(g?.items) ? g.items : [];
                if (!its.length) continue;
                const rows = its.map((it, i) => {
                  const nm = it?.name ?? '';
                  const pr = extractDeltaQ(it);
                  return <span key={i}>{nm}{pr ? ` (${fmtCurrency(pr)})` : ''}{i < its.length - 1 ? ', ' : ''}</span>;
                });
                groupRows.push(
                  <div className="ms-3 text-muted" key={`og-${idx}-${g.groupId || g.groupName}`}>
                    <span className="fw-semibold">{g?.groupName ?? 'Opciones'}:</span> {rows}
                  </div>
                );
              }
            }

            // B) options legacy
            if (Array.isArray(l?.options)) {
              for (const g of l.options) {
                const sel = Array.isArray(g?.selected) ? g.selected : [];
                if (!sel.length) continue;
                const rows = sel.map((s, i) => {
                  const nm = s?.name ?? '';
                  const pr = extractDeltaQ(s);
                  return <span key={i}>{nm}{pr ? ` (${fmtCurrency(pr)})` : ''}{i < sel.length - 1 ? ', ' : ''}</span>;
                });
                groupRows.push(
                  <div className="ms-3 text-muted" key={`op-${idx}-${g.groupName}`}>
                    <span className="fw-semibold">{g?.groupName ?? 'Opciones'}:</span> {rows}
                  </div>
                );
              }
            }

            // C) buckets: addons/extras/modifiers (cada item con precio si lo trae)
            for (const key of ['addons', 'extras', 'modifiers'] as const) {
              const arr: any[] = (l as any)[key];
              if (Array.isArray(arr) && arr.length) {
                const rows = arr.map((x, i) => {
                  if (typeof x === 'string') return <span key={i}>{x}{i < arr.length - 1 ? ', ' : ''}</span>;
                  const nm = x?.name ?? '';
                  const pr = extractDeltaQ(x);
                  return <span key={i}>{nm}{pr ? ` (${fmtCurrency(pr)})` : ''}{i < arr.length - 1 ? ', ' : ''}</span>;
                });
                groupRows.push(
                  <div className="ms-3 text-muted" key={`bk-${idx}-${key}`}>
                    <span className="fw-semibold">{key}:</span> {rows}
                  </div>
                );
              }
            }

            return (
              <div key={idx} className="small mb-2">
                <div className="d-flex justify-content-between">
                  <div>• {qty} × {name}</div>
                  <div className="text-muted">({fmtCurrency(baseUnit)} c/u)</div>
                </div>
                {groupRows}
                {lineTotal > 0 && (
                  <div className="d-flex justify-content-between">
                    <span className="text-muted">Subtotal línea</span>
                    <span className="text-muted">{fmtCurrency(lineTotal)}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Totales */}
        <div className="d-flex justify-content-between align-items-center">
          <div className="small">
            Total: <span className="fw-semibold">{fmtCurrency(totals.total)}</span>
            {totals.tip ? <span className="text-muted"> · propina {fmtCurrency(totals.tip)}</span> : null}
          </div>

          <div className="btn-group">
            <a
              className="btn btn-outline-secondary btn-sm"
              href={`/admin/cashier/receipt/${o.id}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Imprimir recibo
            </a>
            <button className="btn btn-success btn-sm" onClick={() => onClose(o)} disabled={busy}>
              Cerrar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ===================================================
   Página /admin/cashier
=================================================== */
function CashierPage_Inner() {
  const { authReady, user } = useAuthClaims();
  const { orders, loading, error, refresh } = useCashierOrders(!!user, 4000);

  const [busyId, setBusyId] = useState<string | null>(null);

  const onClose = async (o: OrderDoc) => {
    try {
      setBusyId(o.id);
      await advanceToClose(o, async () => {}); // encadena pasos permitidos hasta 'closed'
      await refresh();
    } catch (e: any) {
      alert(e?.message || 'No se pudo cerrar la orden.');
    } finally {
      setBusyId(null);
    }
  };

  // separar por tipo para columnas
  const dineIn = orders.filter(o => {
    const t = (o.orderInfo?.type?.toLowerCase?.() === 'delivery') ? 'delivery' : (o.type || (o.deliveryAddress ? 'delivery' : 'dine_in'));
    return t === 'dine_in';
  }).slice().sort((a, b) => (toDate(b.createdAt).getTime() - toDate(a.createdAt).getTime()));

  const delivery = orders.filter(o => {
    const t = (o.orderInfo?.type?.toLowerCase?.() === 'delivery') ? 'delivery' : (o.type || (o.deliveryAddress ? 'delivery' : 'dine_in'));
    return t === 'delivery';
  }).slice().sort((a, b) => (toDate(b.createdAt).getTime() - toDate(a.createdAt).getTime()));

  return (
    <div className="container py-3">
      <div className="d-flex align-items-center justify-content-between gap-3 mb-3 sticky-top bg-white py-2" style={{ top: 0, zIndex: 5, borderBottom: '1px solid #eee' }}>
        <div className="d-flex align-items-center gap-3">
          <h1 className="h4 m-0">Caja — Cashier</h1>
          <span className="text-muted small d-none d-md-inline">
            Órdenes desde <strong>Cocina lista</strong> en adelante. Desde aquí puedes imprimir y cerrar.
          </span>
        </div>
        <div className="d-flex align-items-center gap-2">
          <button className="btn btn-outline-secondary btn-sm" onClick={() => refresh()}>Refrescar</button>
        </div>
      </div>

      {!authReady && <div className="text-muted">Inicializando sesión…</div>}
      {authReady && !user && <div className="text-danger">No has iniciado sesión.</div>}
      {error && <div className="text-danger">{error}</div>}
      {user && loading && <div className="text-muted">Cargando órdenes…</div>}

      {user && !loading && (
        <>
          {/* Dine-in */}
          <section className="mb-4">
            <div className="d-flex align-items-center justify-content-between mb-2">
              <h2 className="h5 m-0">Salón (Dine-in)</h2>
              <span className="badge bg-secondary">{dineIn.length}</span>
            </div>
            {dineIn.length === 0 ? (
              <div className="text-muted small">No hay órdenes dine-in.</div>
            ) : (
              <div className="row g-3">
                {dineIn.map(o => (
                  <div key={o.id} className="col-12 col-md-6 col-lg-4">
                    <OrderCard o={o} onClose={onClose} busy={busyId === o.id} />
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Delivery */}
          <section className="mt-4">
            <div className="d-flex align-items-center justify-content-between mb-2">
              <h2 className="h5 m-0">Delivery</h2>
              <span className="badge bg-secondary">{delivery.length}</span>
            </div>
            {delivery.length === 0 ? (
              <div className="text-muted small">No hay órdenes de delivery.</div>
            ) : (
              <div className="row g-3">
                {delivery.map(o => (
                  <div key={o.id} className="col-12 col-md-6 col-lg-4">
                    <OrderCard o={o} onClose={onClose} busy={busyId === o.id} />
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}


export default function CashierPage() {
  return (
    <OnlyCashier>
      <CashierPage_Inner />
    </OnlyCashier>
  );
}
