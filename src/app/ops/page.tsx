"use client";

import React from "react";
import { useEffect, useMemo, useRef, useState } from "react";

/* --------------------------------------------
   Firebase init (client)
--------------------------------------------- */
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
  const app = await import("firebase/app");
  if (!app.getApps().length) {
    const cfg = getFirebaseClientConfig();
    if (cfg.apiKey && cfg.authDomain && cfg.projectId && cfg.appId) {
      app.initializeApp(cfg);
    } else {
      console.warn("[Firebase] Variables NEXT_PUBLIC_* faltantes; Auth no podrá inicializar.");
    }
  }
}

/* --------------------------------------------
   Firebase Auth helpers
--------------------------------------------- */
async function getAuthMod() {
  await ensureFirebaseApp();
  const mod = await import("firebase/auth");
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
    return () => {
      mounted = false;
    };
  }, []);
  return { authReady, user } as const;
}
function useAuthClaims() {
  const { authReady, user } = useAuthState();
  const [claims, setClaims] = useState<any | null>(null);
  useEffect(() => {
    let mounted = true;
    (async () => {
      if (!user) {
        setClaims(null);
        return;
      }
      const res = await getIdTokenResultSafe();
      if (mounted) setClaims(res?.claims ?? null);
    })();
    return () => {
      mounted = false;
    };
  }, [user]);
  const flags = useMemo(
    () => ({
      isAdmin: !!claims?.admin,
      isKitchen: !!claims?.kitchen || !!claims?.admin,
      isWaiter: !!claims?.waiter || !!claims?.admin,
      isDelivery: !!claims?.delivery || !!claims?.admin,
    }),
    [claims]
  );
  return { authReady, user, claims, ...flags } as const;
}

/* --------------------------------------------
   Fetch helper con reintento 401
--------------------------------------------- */
async function apiFetch(path: string, init?: RequestInit) {
  let token = await getIdTokenSafe(false);
  let headers: HeadersInit = { ...(init?.headers || {}) };
  if (token) (headers as any)["Authorization"] = `Bearer ${token}`;
  let res = await fetch(path, { ...init, headers });

  if (res.status === 401) {
    console.warn("[apiFetch] 401, intentando refresh de token…");
    token = await getIdTokenSafe(true);
    headers = { ...(init?.headers || {}) };
    if (token) (headers as any)["Authorization"] = `Bearer ${token}`;
    res = await fetch(path, { ...init, headers });
  }
  return res;
}

/* --------------------------------------------
   Types (SNAKE_CASE)
--------------------------------------------- */
type StatusSnake =
  | "cart"
  | "placed"
  | "kitchen_in_progress"
  | "kitchen_done"
  | "ready_to_close"
  | "assigned_to_courier"
  | "on_the_way"
  | "delivered"
  | "closed"
  | "cancelled";

type OrderItemLine = {
  menuItemName: string;
  quantity: number;
  options?: Array<{ groupName: string; selected: Array<{ name: string; priceDelta?: number }> }>;
  addons?: Array<string | { name: string; priceDelta?: number }>;
  extras?: Array<string | { name: string; priceDelta?: number }>;
  modifiers?: Array<string | { name: string; priceDelta?: number }>;
  unitPriceCents?: number;
  priceCents?: number;
  price?: number;
  totalCents?: number;
};
type StatusHistoryEntry = {
  at: string;
  by?: string | null;
  from: StatusSnake;
  to: StatusSnake;
  idem?: string | null;
};
type Amounts = {
  subtotal?: number;
  serviceFee?: number;
  discount?: number;
  taxableBase?: number;
  tax?: number;
  tip?: number;
  total?: number;
};
type OrderDoc = {
  id: string;
  orderNumber?: string;
  type?: "dine_in" | "delivery";
  status: StatusSnake;
  items: OrderItemLine[];
  amounts?: Amounts;
  totals?: { totalCents?: number };
  tableNumber?: string | null;
  deliveryAddress?: string | null;
  notes?: string | null;
  createdAt?: any;
  statusHistory?: StatusHistoryEntry[];
  lines?: OrderItemLine[];
};

/* --------------------------------------------
   Utils
--------------------------------------------- */
const TitleMap: Record<StatusSnake, string> = {
  cart: "Carrito",
  placed: "Recibido",
  kitchen_in_progress: "En cocina",
  kitchen_done: "Cocina lista",
  ready_to_close: "Listo para cerrar",
  assigned_to_courier: "Asignado a repartidor",
  on_the_way: "En camino",
  delivered: "Entregado",
  closed: "Cerrado",
  cancelled: "Cancelado",
};
function toDate(x: any): Date {
  if (x?.toDate?.() instanceof Date) return x.toDate();
  const d = new Date(x);
  return isNaN(d.getTime()) ? new Date() : d;
}
function fmtCurrency(n?: number, currency = "GTQ") {
  if (typeof n !== "number") return "—";
  try {
    return new Intl.NumberFormat("es-GT", { style: "currency", currency }).format(n);
  } catch {
    return n.toFixed(2);
  }
}
function timeAgo(from: Date, now: Date) {
  const ms = Math.max(0, now.getTime() - from.getTime());
  const m = Math.floor(ms / 60000);
  if (m < 1) return "hace segundos";
  if (m < 60) return `hace ${m} min`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return `hace ${h} h ${rem} m`;
}
function toSnakeStatus(s: string): StatusSnake {
  if (!s) return "placed";
  const snake = s.includes("_") ? s : s.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
  const aliasMap: Record<string, StatusSnake> = {
    ready: "ready_to_close",
    served: "ready_to_close",
    completed: "closed",
    ready_for_delivery: "assigned_to_courier",
    out_for_delivery: "on_the_way",
  };
  return (aliasMap[snake] ?? (snake as StatusSnake)) as StatusSnake;
}
function byCreatedAtDesc(a: any, b: any) {
  const ta = a.createdAt?._seconds ? a.createdAt._seconds * 1000 : (a.createdAt ? new Date(a.createdAt).getTime() : 0);
  const tb = b.createdAt?._seconds ? b.createdAt._seconds * 1000 : (b.createdAt ? new Date(b.createdAt).getTime() : 0);
  return tb - ta;
}

/* --------------------------------------------
   Flujos por tipo (para botones y 'Atrás')
--------------------------------------------- */
const FLOW_DINE_IN: StatusSnake[] = ["placed", "kitchen_in_progress", "kitchen_done", "ready_to_close", "closed"];
const FLOW_DELIVERY: StatusSnake[] = ["placed", "kitchen_in_progress", "kitchen_done", "assigned_to_courier", "on_the_way", "delivered", "closed"];

function getPrevStatus(order: OrderDoc): StatusSnake | null {
  const t = order.type || (order.deliveryAddress ? "delivery" : "dine_in");
  const flow = t === "dine_in" ? FLOW_DINE_IN : FLOW_DELIVERY;
  const idx = flow.indexOf(order.status);
  if (idx > 0) return flow[idx - 1];
  return null;
}

/* ✅ Validación mínima en cliente: siguientes estados permitidos */
function allowedNextStatuses(type: "dine_in" | "delivery", from: StatusSnake): StatusSnake[] {
  if (type === "delivery") {
    switch (from) {
      case "placed": return ["kitchen_in_progress"];
      case "kitchen_in_progress": return ["kitchen_done"];              // ← evita salto erróneo
      case "kitchen_done": return ["assigned_to_courier"];
      case "assigned_to_courier": return ["on_the_way"];
      case "on_the_way": return ["delivered"];
      case "delivered": return ["closed"];
      default: return [];
    }
  } else {
    switch (from) {
      case "placed": return ["kitchen_in_progress"];
      case "kitchen_in_progress": return ["kitchen_done"];
      case "kitchen_done": return ["ready_to_close"];
      case "ready_to_close": return ["closed"];
      default: return [];
    }
  }
}

/* --------------------------------------------
   Helpers de ítems/addons y total
--------------------------------------------- */
function getLineQty(l: any): number {
  return Number(l?.quantity ?? l?.qty ?? 1) || 1;
}
function getLineName(l: any): string {
  return String(l?.menuItemName ?? l?.name ?? l?.menuItem?.name ?? "Ítem");
}
function getLineTotalCents(l: any): number | undefined {
  const qty = getLineQty(l);
  if (Number.isFinite(l?.totalCents)) return Number(l.totalCents);
  if (Number.isFinite(l?.unitPriceCents)) return Number(l.unitPriceCents) * qty;
  if (Number.isFinite(l?.priceCents)) return Number(l.priceCents) * qty;
  if (Number.isFinite(l?.price)) return Math.round(Number(l.price) * 100) * qty;
  return undefined;
}
function normalizeOptions(l: any): Array<{ label: string; values: string[] }> {
  const res: Array<{ label: string; values: string[] }> = [];
  if (Array.isArray(l?.options)) {
    for (const g of l.options) {
      const label = String(g?.groupName ?? "Opciones");
      const values = Array.isArray(g?.selected) ? g.selected.map((s: any) => String(s?.name ?? s)).filter(Boolean) : [];
      if (values.length) res.push({ label, values });
    }
  }
  const buckets = [
    { key: "addons", label: "Extras" },
    { key: "extras", label: "Extras" },
    { key: "modifiers", label: "Modificadores" },
  ];
  for (const b of buckets) {
    const arr = l?.[b.key];
    if (Array.isArray(arr) && arr.length) {
      const vals = arr
        .map((x: any) => (typeof x === "string" ? x : x?.name ? String(x.name) : null))
        .filter(Boolean) as string[];
      if (vals.length) res.push({ label: b.label, values: vals });
    }
  }
  return res;
}
function computeOrderTotalGTQ(o: OrderDoc): number | undefined {
  if (Number.isFinite(o?.amounts?.total)) return Number(o.amounts!.total);
  if (Number.isFinite(o?.amounts?.subtotal)) return Number(o.amounts!.subtotal);
  if (Number.isFinite(o?.totals?.totalCents)) return Number(o.totals!.totalCents) / 100;
  const lines: any[] = Array.isArray(o?.items) && o.items.length ? o.items : (Array.isArray(o?.lines) ? o.lines! : []);
  if (!lines.length) return undefined;
  const cents = lines.reduce((acc, l) => {
    const t = getLineTotalCents(l);
    return acc + (Number.isFinite(t) ? Number(t) : 0);
  }, 0);
  return cents > 0 ? cents / 100 : undefined;
}

/* --------------------------------------------
   Hook de órdenes
--------------------------------------------- */
const STATUS_QUERY = [
  "placed",
  "kitchen_in_progress",
  "kitchen_done",
  "ready_to_close",
  "assigned_to_courier",
  "on_the_way",
  "delivered",
].join(",");
const TYPE_QUERY = ["dine_in", "delivery"].join(",");

function useOrders(
  enabled: boolean,
  pollMs = 5000,
  onChange?: (prev: Map<string, string>, next: Map<string, string>) => void
) {
  const [orders, setOrders] = useState<OrderDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<any>(null);
  const prevMapRef = useRef<Map<string, string>>(new Map());

  const fetchNow = async () => {
    try {
      setError(null);
      if (!enabled) {
        setLoading(false);
        return;
      }
      const token = await getIdTokenSafe(false);
      if (!token) {
        setLoading(false);
        setError("Debes iniciar sesión para ver órdenes.");
        return;
      }

      const url = `/api/orders?statusIn=${encodeURIComponent(
        STATUS_QUERY
      )}&typeIn=${encodeURIComponent(TYPE_QUERY)}&limit=100`;

      const res = await apiFetch(url);
      if (res.status === 401) throw new Error("Unauthorized (401). Inicia sesión nuevamente.");
      if (!res.ok) throw new Error(`GET /orders ${res.status}`);

      const data = await res.json();
      const rawList = (data.items ?? data.orders ?? []) as any[];
      if (!Array.isArray(rawList)) {
        console.error("Formato inesperado en /api/orders:", data);
        setOrders([]);
        setLoading(false);
        setError("Respuesta inesperada del servidor.");
        return;
      }

      const list: OrderDoc[] = rawList.map((d) => {
        const normalizedStatus = toSnakeStatus(String(d.status || "placed"));
        const typeVal = (d.type || (d.deliveryAddress ? "delivery" : "dine_in")) as "dine_in" | "delivery";
        return { ...d, status: normalizedStatus, type: typeVal } as OrderDoc;
      });

      setOrders(list);
      setLoading(false);

      const nextMap = new Map<string, string>(list.map((o) => [o.id, o.status]));
      if (onChange) onChange(prevMapRef.current, nextMap);
      prevMapRef.current = nextMap;
    } catch (e: any) {
      setError(e?.message || "Error al cargar");
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

/* --------------------------------------------
   Sonido
--------------------------------------------- */
function useBeep(enabled: boolean) {
  const ctxRef = useRef<AudioContext | null>(null);
  useEffect(() => {
    if (!enabled) return;
    if (!ctxRef.current) ctxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
  }, [enabled]);
  const beep = async (durationMs = 160) => {
    if (!enabled) return;
    try {
      const ctx = ctxRef.current ?? new (window.AudioContext || (window as any).webkitAudioContext)();
      ctxRef.current = ctx;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.value = 880;
      o.connect(g);
      g.connect(ctx.destination);
      o.start();
      g.gain.setValueAtTime(0.15, ctx.currentTime);
      o.stop(ctx.currentTime + durationMs / 1000 + 0.01);
    } catch {}
  };
  return beep;
}

/* --------------------------------------------
   Acciones de status
--------------------------------------------- */
function nextActionsFor(
  order: OrderDoc,
  claims: { isAdmin: boolean; isKitchen: boolean; isWaiter: boolean; isDelivery: boolean }
) {
  const t = order.type || (order.deliveryAddress ? "delivery" : "dine_in");
  const acts: Array<{ label: string; to: StatusSnake; show: boolean }> = [];

  if (t === "dine_in") {
    if (order.status === "placed") acts.push({ label: "Iniciar cocina", to: "kitchen_in_progress", show: claims.isKitchen });
    if (order.status === "kitchen_in_progress") acts.push({ label: "Cocina lista", to: "kitchen_done", show: claims.isKitchen });
    if (order.status === "kitchen_done") acts.push({ label: "Listo para cerrar", to: "ready_to_close", show: claims.isKitchen || claims.isWaiter });
    if (order.status === "ready_to_close") acts.push({ label: "Cerrar", to: "closed", show: claims.isWaiter || claims.isAdmin });
  } else {
    // DELIVERY: flujo correcto
    if (order.status === "placed") acts.push({ label: "Iniciar cocina", to: "kitchen_in_progress", show: claims.isKitchen });
    if (order.status === "kitchen_in_progress") acts.push({ label: "Cocina lista", to: "kitchen_done", show: claims.isKitchen });
    if (order.status === "kitchen_done") acts.push({ label: "Asignar repartidor", to: "assigned_to_courier", show: claims.isKitchen || claims.isAdmin });
    if (order.status === "assigned_to_courier") acts.push({ label: "Marcar en camino", to: "on_the_way", show: claims.isDelivery || claims.isAdmin });
    if (order.status === "on_the_way") acts.push({ label: "Entregado", to: "delivered", show: claims.isDelivery || claims.isAdmin });
    if (order.status === "delivered") acts.push({ label: "Cerrar", to: "closed", show: claims.isAdmin });
  }

  if ((claims as any).isAdmin) for (const a of acts) a.show = true;
  return acts.filter((a) => a.show);
}

async function changeStatus(orderId: string, to: StatusSnake) {
  const key = `${orderId}:${to}:${Date.now()}`;
  const res = await apiFetch(`/api/orders/${orderId}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "X-Idempotency-Key": key },
    body: JSON.stringify({ nextStatus: to }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.error || `Status ${res.status}`);
  }
  return res.json();
}

/* --------------------------------------------
   UI: Tarjeta
--------------------------------------------- */
function BadgeStatus({ s }: { s: StatusSnake }) {
  const map: Record<StatusSnake, string> = {
    placed: "bg-primary",
    kitchen_in_progress: "bg-warning text-dark",
    kitchen_done: "bg-secondary",
    ready_to_close: "bg-success",
    assigned_to_courier: "bg-info text-dark",
    on_the_way: "bg-info text-dark",
    delivered: "bg-success",
    closed: "bg-dark",
    cancelled: "bg-danger",
    cart: "bg-light text-dark",
  };
  const cls = `badge ${map[s] || "bg-light text-dark"}`;
  return <span className={cls}>{TitleMap[s] || s}</span>;
}

function OrderCard({
  o,
  claims,
  onAction,
  busyKey,
}: {
  o: OrderDoc;
  claims: { isAdmin: boolean; isKitchen: boolean; isWaiter: boolean; isDelivery: boolean };
  onAction: (id: string, to: StatusSnake) => Promise<void>;
  busyKey: string | null;
}) {
  const created = toDate(o.createdAt ?? new Date());
  const totalGTQ = computeOrderTotalGTQ(o);
  const isBusy = (to: StatusSnake) => busyKey === `${o.id}:${to}`;
  const prev = getPrevStatus(o);
  const nexts = nextActionsFor(o, claims);

  return (
    <div className="card shadow-sm">
      <div className="card-header d-flex align-items-center justify-content-between">
        <div className="d-flex flex-column">
          <div className="fw-semibold">#{o.orderNumber || o.id}</div>
          {o.tableNumber && <div className="fw-semibold">Mesa {o.tableNumber}</div>}
          <small className="text-muted">
            {created.toLocaleString()} · {timeAgo(created, new Date())}
          </small>
        </div>
        <div className="d-flex gap-2 align-items-center">
          <span className="badge bg-outline-secondary text-dark">
            {o.type || (o.deliveryAddress ? "delivery" : "dine_in")}
          </span>
          <BadgeStatus s={o.status} />
        </div>
      </div>
      <div className="card-body">
        {o.deliveryAddress ? (
          <div className="mb-1">
            <strong>Entrega:</strong> {o.deliveryAddress}
          </div>
        ) : null}
        {o.notes ? (
          <div className="mb-2">
            <em>Nota: {o.notes}</em>
          </div>
        ) : null}

        {/* Ítems + addons/opciones */}
        <div className="mb-2">
          {(o.items?.length ? o.items : o.lines || []).map((it: any, idx: number) => {
            const groups = normalizeOptions(it);
            return (
              <div key={idx} className="small mb-1">
                • {getLineQty(it)} × {getLineName(it)}
                {!!groups.length && (
                  <div className="ms-3 text-muted">
                    {groups.map((g, ix) => (
                      <div key={ix}>
                        <span className="fw-semibold">{g.label}:</span>{" "}
                        <span>{g.values.join(", ")}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Total y acciones */}
        <div className="d-flex justify-content-between align-items-center">
          <div className="small">
            Total: <span className="fw-semibold">{fmtCurrency(totalGTQ)}</span>
            {o.amounts?.tip ? (
              <span className="text-muted"> · propina {fmtCurrency(o.amounts.tip)}</span>
            ) : null}
          </div>

          <div className="btn-group">
            {prev && (
              <button
                type="button"
                className="btn btn-outline-secondary btn-sm"
                disabled={isBusy(prev)}
                onClick={() => onAction(o.id, prev)}
                title="Retroceder estado"
              >
                ← Atrás
              </button>
            )}
            {nexts.map((a) => (
              <button
                key={a.to}
                type="button"
                className="btn btn-primary btn-sm"
                disabled={isBusy(a.to)}
                onClick={() => onAction(o.id, a.to)}
                title={a.label}
              >
                {a.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* --------------------------------------------
   Página
--------------------------------------------- */
export default function OpsBoardsPage() {
  const { authReady, user, ...claims } = useAuthClaims();

  const [soundOn, setSoundOn] = useState(true);
  const beep = useBeep(soundOn);
  const onOrdersChange = async (prev: Map<string, string>, next: Map<string, string>) => {
    for (const [id, status] of next.entries()) {
      const prevStatus = prev.get(id);
      if (prevStatus && prevStatus !== status) {
        await beep();
        break;
      }
    }
  };

  const { orders, loading, error, refresh } = useOrders(!!user, 4000, onOrdersChange);

  // 🔒 Guard adicional antes de llamar a la API
  const doAct = async (id: string, to: StatusSnake) => {
    try {
      const order = orders.find((o) => o.id === id);
      if (!order) throw new Error("Orden no encontrada");
      const type = order.type || (order.deliveryAddress ? "delivery" : "dine_in");
      const allowed = allowedNextStatuses(type, order.status);

      if (!allowed.includes(to)) {
        // Mensaje claro y sin llamar al backend
        const msg =
          type === "delivery" && order.status === "kitchen_in_progress" && to === "assigned_to_courier"
            ? 'Primero marca "Cocina lista" (kitchen_done) antes de asignar repartidor.'
            : `Transición no permitida desde "${TitleMap[order.status]}" a "${TitleMap[to]}".`;
        alert(msg);
        return;
      }

      setBusy(`${id}:${to}`);
      await changeStatus(id, to);
      await refresh();
    } catch (e: any) {
      alert(e?.message || "Error");
    } finally {
      setBusy(null);
    }
  };

  // Búsqueda simple
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return orders.filter((o) => {
      if (!term) return true;
      const hay = [o.orderNumber, o.id, o.tableNumber, o.deliveryAddress, o.notes, ...(o.items?.map((i) => i.menuItemName) || [])]
        .join(" ")
        .toLowerCase();
      return hay.includes(term);
    });
  }, [orders, q]);

  // Split por tipo y ordenado por fecha
  const dineIn = filtered
    .filter((o) => (o.type || (o.deliveryAddress ? "delivery" : "dine_in")) === "dine_in")
    .slice()
    .sort(byCreatedAtDesc);
  const delivery = filtered
    .filter((o) => (o.type || (o.deliveryAddress ? "delivery" : "dine_in")) === "delivery")
    .slice()
    .sort(byCreatedAtDesc);

  const [busy, setBusy] = useState<string | null>(null);

  return (
    <div className="container py-3">
      {/* Topbar */}
      <div className="d-flex align-items-center justify-content-between gap-3 mb-3 sticky-top bg-white py-2" style={{ top: 0, zIndex: 5, borderBottom: '1px solid #eee' }}>
        <div className="d-flex align-items-center gap-3">
          <h1 className="h4 m-0">Operación — KDS / Mesero / Delivery</h1>
          <span className="text-muted small d-none d-md-inline">
            Los botones dependen de tus roles (kitchen / waiter / delivery / admin).
          </span>
        </div>
        <div className="d-flex align-items-center gap-2">
          <div className="input-group input-group-sm" style={{ width: 260 }}>
            <span className="input-group-text">Buscar</span>
            <input
              type="search"
              className="form-control"
              placeholder="#orden, mesa, dirección, ítem, nota"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <button className="btn btn-outline-secondary btn-sm" onClick={() => refresh()}>Refrescar</button>
          <div className="form-check form-switch">
            <input className="form-check-input" type="checkbox" id="soundSwitch" checked={soundOn} onChange={(e) => setSoundOn(e.target.checked)} />
            <label className="form-check-label small" htmlFor="soundSwitch">Sonido</label>
          </div>
        </div>
      </div>

      {/* Estado de auth */}
      {!authReady && <div className="text-muted">Inicializando sesión…</div>}
      {authReady && !user && <div className="text-danger">No has iniciado sesión. Inicia sesión para ver las órdenes.</div>}
      {error && <div className="text-danger">{error}</div>}
      {user && loading && <div className="text-muted">Cargando pedidos…</div>}

      {/* ---------- Sección DINE-IN ---------- */}
      {user && (
        <section className="mb-4">
          <div className="d-flex align-items-center justify-content-between mb-2">
            <h2 className="h5 m-0">Salón (Dine-in)</h2>
            <span className="badge bg-secondary">{dineIn.length}</span>
          </div>

          {dineIn.length === 0 ? (
            <div className="text-muted small">No hay órdenes dine-in.</div>
          ) : (
            <div className="row g-3">
              {dineIn.map((o) => (
                <div key={o.id} className="col-12 col-md-6 col-lg-4">
                  <OrderCard o={o} claims={claims as any} onAction={doAct} busyKey={busy} />
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* ---------- Sección DELIVERY ---------- */}
      {user && (
        <section className="mt-4">
          <div className="d-flex align-items-center justify-content-between mb-2">
            <h2 className="h5 m-0">Delivery</h2>
            <span className="badge bg-secondary">{delivery.length}</span>
          </div>

          {delivery.length === 0 ? (
            <div className="text-muted small">No hay órdenes de delivery.</div>
          ) : (
            <div className="row g-3">
              {delivery.map((o) => (
                <div key={o.id} className="col-12 col-md-6 col-lg-4">
                  <OrderCard o={o} claims={claims as any} onAction={doAct} busyKey={busy} />
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
