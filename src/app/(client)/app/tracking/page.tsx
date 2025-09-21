"use client";

import React, { useEffect, useRef, useState } from "react";
import Protected from "@/components/Protected";

/*Firebase (cliente)*/
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
      console.warn("[Firebase] Missing public configuration; Auth is not able to initialize.");
    }
  }
}

/*Auth helpers*/
async function getAuthMod() {
  await ensureFirebaseApp();
  return await import("firebase/auth");
}
function useAuthState() {
  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState<any | null>(null);
  useEffect(() => {
    let mounted = true;
    (async () => {
      const { getAuth, onAuthStateChanged } = await getAuthMod();
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

/* API fetch con reintento 401*/
async function apiFetch(path: string, init?: RequestInit) {
  let token = await getIdTokenSafe(false);
  let headers: HeadersInit = { ...(init?.headers || {}) };
  if (token) (headers as any)["Authorization"] = `Bearer ${token}`;
  let res = await fetch(path, { ...init, headers });

  if (res.status === 401) {
    token = await getIdTokenSafe(true);
    headers = { ...(init?.headers || {}) };
    if (token) (headers as any)["Authorization"] = `Bearer ${token}`;
    res = await fetch(path, { ...init, headers });
  }
  return res;
}

/* Tipos */
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
  menuItemName?: string;
  name?: string;
  quantity?: number;
  optionGroups?: Array<{
    groupId?: string;
    groupName?: string;
    type?: "single" | "multiple";
    items: Array<{ id?: string; name?: string; priceDelta?: number }>;
  }>;
  options?: Array<{ groupName: string; selected: Array<{ name: string; priceDelta?: number }> }>;
  addons?: Array<string | { name: string; priceDelta?: number }>;
  extras?: Array<string | { name: string; priceDelta?: number }>;
  modifiers?: Array<string | { name: string; priceDelta?: number }>;
  groupItems?: Array<string | { name: string }>;
};

type OrderDoc = {
  id: string;
  orderNumber?: string;
  type?: "dine_in" | "delivery";
  status: StatusSnake;
  items?: OrderItemLine[];
  lines?: OrderItemLine[];
  createdAt?: any;
  notes?: string | null;
  deliveryAddress?: string | null;
  orderInfo?: {
    type?: "dine-in" | "delivery";
    notes?: string;
    address?: string;
    phone?: string;
    delivery?: "pending" | "inroute" | "delivered";
    courierName?: string | null;
  } | any;
};

/* Helpers de presentación */
const TitleMap: Record<StatusSnake, string> = {
  cart: "Cart",
  placed: "Received",
  kitchen_in_progress: "In kitchen",
  kitchen_done: "Kitchen ready",
  ready_to_close: "Ready to close",
  assigned_to_courier: "Assigned to courier",
  on_the_way: "On the way",
  delivered: "Delivered",
  closed: "Closed",
  cancelled: "Cancelled",
};

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

function getDisplayType(o: OrderDoc): "dine_in" | "delivery" {
  const infoType = String(o?.orderInfo?.type || "").toLowerCase();
  if (infoType === "delivery") return "delivery";
  if (infoType === "dine-in" || infoType === "dine_in") return "dine_in";
  if (o.type === "delivery") return "delivery";
  if (o.type === "dine_in") return "dine_in";
  if (o.deliveryAddress) return "delivery";
  return "dine_in";
}
function getDisplayAddress(o: OrderDoc): string | null {
  const a = o?.orderInfo?.address;
  if (a) return String(a);
  return o.deliveryAddress ?? null;
}
function getDisplayPhone(o: OrderDoc): string | null {
  const p = o?.orderInfo?.phone;
  if (p) return String(p);
  return null;
}
function getDisplayNotes(o: OrderDoc): string | null {
  const n = o?.orderInfo?.notes;
  if (n) return String(n);
  return o.notes ?? null;
}

/* Datos: traer mis órdenes delivery, visibles mientras subestado !== delivered */

const STATUS_QUERY_MAIN = [
  "placed",
  "kitchen_in_progress",
  "kitchen_done",
  "ready_to_close",
  "closed",
  "assigned_to_courier",
  "on_the_way",
  "delivered",
].join(",");
const TYPE_QUERY = ["delivery"].join(",");

function useMyDeliveryOrders(enabled: boolean, pollMs = 4000) {
  const [orders, setOrders] = useState<OrderDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<any>(null);

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
        setError("You must sign in.");
        return;
      }

      const url = `/api/orders?statusIn=${encodeURIComponent(
        STATUS_QUERY_MAIN
      )}&typeIn=${encodeURIComponent(TYPE_QUERY)}&limit=100`;
      const res = await apiFetch(url);
      if (res.status === 401) throw new Error("Unauthorized (401).");
      if (!res.ok) throw new Error(`GET /orders ${res.status}`);

      const data = await res.json();
      const rawList = (data.items ?? data.orders ?? []) as any[];
      const listRaw: OrderDoc[] = (rawList || []).map((d) => ({
        ...d,
        status: toSnakeStatus(String(d.status || "placed")),
      }));

      const list = listRaw
        .filter((o) => getDisplayType(o) === "delivery")
        .filter((o) => String(o?.orderInfo?.delivery || "pending") !== "delivered")
        .sort((a, b) => {
          const ta = a.createdAt?._seconds
            ? a.createdAt._seconds * 1000
            : a.createdAt
            ? new Date(a.createdAt).getTime()
            : 0;
          const tb = b.createdAt?._seconds
            ? b.createdAt._seconds * 1000
            : b.createdAt
            ? new Date(b.createdAt).getTime()
            : 0;
          return tb - ta;
        });

      setOrders(list);
      setLoading(false);
    } catch (e: any) {
      setError(e?.message || "Error loading");
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

/* Timeline unificado (cocina + delivery)
   Pasos:
   1) Recibido
   2) En cocina
   3) Cocina lista
   4) Asignado a repartidor (visual si courierName)
   5) En ruta (delivery = inroute)
   6) Entregado (delivery = delivered) */

type TimelineStepKey =
  | "placed"
  | "kitchen_in_progress"
  | "kitchen_done"
  | "assigned_to_courier_visual"
  | "inroute"
  | "delivered";

const STEP_LABELS: Record<TimelineStepKey, string> = {
  placed: "Received",
  kitchen_in_progress: "In kitchen",
  kitchen_done: "Kitchen ready",
  assigned_to_courier_visual: "Assigned to courier",
  inroute: "On the way",
  delivered: "Delivered",
};

function getStepState(
  order: OrderDoc
): { steps: Array<{ key: TimelineStepKey; label: string }>; activeIndex: number } {
  const courierName = order?.orderInfo?.courierName ?? null;
  const sub: "pending" | "inroute" | "delivered" = order?.orderInfo?.delivery ?? "pending";

  const steps: Array<{ key: TimelineStepKey; label: string }> = [
    { key: "placed", label: STEP_LABELS.placed },
    { key: "kitchen_in_progress", label: STEP_LABELS.kitchen_in_progress },
    { key: "kitchen_done", label: STEP_LABELS.kitchen_done },
    { key: "assigned_to_courier_visual", label: STEP_LABELS.assigned_to_courier_visual },
    { key: "inroute", label: STEP_LABELS.inroute },
    { key: "delivered", label: STEP_LABELS.delivered },
  ];

  // Determinar índice activo combinando principal + delivery
  // Cocina:
  const main = order.status;
  let idx = 0;
  if (main === "kitchen_in_progress") idx = 1;
  else if (main === "kitchen_done") idx = 2;
  else if (main === "placed") idx = 0;
  else if (["ready_to_close", "assigned_to_courier", "on_the_way", "closed", "delivered"].includes(main))
    idx = 2; // El flujo de cocina termina en 'kitchen_done'

  // Delivery:
  // Paso visual "asignado" si hay courierName
  if (courierName && idx < 3) idx = 3;
  if (sub === "inroute" && idx < 4) idx = 4;
  if (sub === "delivered") idx = 5;

  return { steps, activeIndex: idx };
}

/* Iconos simples */
function StepIcon({ name }: { name: TimelineStepKey }) {
  const map: Record<TimelineStepKey, string> = {
    placed: "🧾",
    kitchen_in_progress: "🍳",
    kitchen_done: "✅",
    assigned_to_courier_visual: "🆔",
    inroute: "🛵",
    delivered: "🏠",
  };
  return (
    <span aria-hidden="true" style={{ fontSize: 18, lineHeight: 1 }}>
      {map[name] ?? "•"}
    </span>
  );
}

/* Componente: Timeline vertical */
function VerticalTimeline({
  steps,
  activeIndex,
}: {
  steps: Array<{ key: TimelineStepKey; label: string }>;
  activeIndex: number; // índice del estado actual
}) {
  return (
    <div className="vtl">
      {steps.map((s, i) => {
        const state = i < activeIndex ? "done" : i === activeIndex ? "active" : "todo";
        return (
          <div className="vtl-row" key={s.key}>
            <div className="vtl-marker">
              <div
                className={`vtl-dot ${
                  state === "done" ? "vtl-done" : state === "active" ? "vtl-active" : "vtl-todo"
                }`}
                aria-label={`${s.label}${state === "active" ? " (current)" : state === "done" ? " (completed)" : ""}`}
              >
                <StepIcon name={s.key} />
              </div>
              {i < steps.length - 1 && <div className="vtl-line" aria-hidden="true" />}
            </div>
            <div className="vtl-label">
              <div className={`vtl-text ${state === "todo" ? "text-muted" : ""}`}>{s.label}</div>
            </div>
          </div>
        );
      })}
      <style jsx>{`
        .vtl {
          display: grid;
          row-gap: 12px;
          padding-left: 2px;
        }
        .vtl-row {
          display: grid;
          grid-template-columns: 28px 1fr;
          column-gap: 10px;
          align-items: start;
        }
        .vtl-marker {
          position: relative;
          display: flex;
          flex-direction: column;
          align-items: center;
        }
        .vtl-dot {
          display: grid;
          place-items: center;
          width: 28px;
          height: 28px;
          border-radius: 50%;
          border: 1px solid #e5e5e5;
          background: #f8f9fa; /* todo */
        }
        .vtl-active {
          background: #0d6efd; /* bootstrap primary */
          color: #fff;
          border-color: #0d6efd;
        }
        .vtl-done {
          background: #198754; /* bootstrap success */
          color: #fff;
          border-color: #198754;
        }
        .vtl-line {
          width: 2px;
          flex: 1 1 auto;
          background: #e9ecef;
          margin-top: 6px;
          margin-bottom: -6px; /* pequeño solape para unir puntos */
        }
        .vtl-label {
          padding-top: 4px;
        }
        .vtl-text {
          font-size: 14px;
        }
        @media (max-width: 576px) {
          .vtl-text {
            font-size: 13px;
          }
        }
      `}</style>
    </div>
  );
}

/* Tarjeta de tracking */
function OrderTrackingCard({ o }: { o: OrderDoc }) {
  const address = getDisplayAddress(o);
  const phone = getDisplayPhone(o);
  const notes = getDisplayNotes(o);
  const courierName: string | null = o?.orderInfo?.courierName ?? null;

  const { steps, activeIndex } = getStepState(o);
  const lines = (o.items?.length ? o.items : o.lines || []);

  return (
    <div className="card shadow-sm">
      <div className="card-body">
        {/* Encabezado simple */}
        <div className="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-2">
          <div className="d-flex align-items-center gap-2">
            <span className="badge bg-dark-subtle text-dark">Delivery</span>
            <div className="fw-semibold">#{o.orderNumber || o.id}</div>
          </div>
          <span className="badge bg-secondary">{TitleMap[o.status]}</span>
        </div>

        {/* Datos rápidos */}
        <div className="row g-2 small mb-3">
          <div className="col-12 col-sm-6">
            <span className="fw-semibold">Address:</span>{" "}
            {address || <em className="text-muted">—</em>}
          </div>
          <div className="col-6 col-sm-3">
            <span className="fw-semibold">Phone:</span>{" "}
            {phone || <em className="text-muted">—</em>}
          </div>
          <div className="col-6 col-sm-3">
            <span className="fw-semibold">Courier:</span>{" "}
            {courierName ? courierName : <em className="text-muted">—</em>}
          </div>
          {notes ? (
            <div className="col-12">
              <span className="fw-semibold">Notes:</span> {notes}
            </div>
          ) : null}
        </div>

        {/* Timeline vertical unificado */}
        <VerticalTimeline steps={steps} activeIndex={activeIndex} />

        {/* Pedido */}
        <div className="mt-3">
          <div className="fw-semibold mb-1">Your order</div>
          <div className="small">
            {(lines || []).map((it, idx) => (
              <div key={idx} className="mb-1">
                • {(Number((it as any)?.quantity ?? 1) || 1)} ×{" "}
                {String(
                  (it as any)?.menuItemName ??
                    (it as any)?.name ??
                    (it as any)?.menuItem?.name ??
                    "Item"
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Ajustes de espaciado responsive */}
      <style jsx>{`
        .card {
          border-radius: 12px;
        }
        @media (max-width: 576px) {
          .card-body {
            padding: 14px;
          }
        }
      `}</style>
    </div>
  );
}

/* --------------------------------------------
   Página Tracking
--------------------------------------------- */
function TrackingPageInner() {
  const { authReady, user } = useAuthState();
  const { orders, loading, error, refresh } = useMyDeliveryOrders(!!user, 4000);

  return (
    <div className="container py-3">
      <div
        className="d-flex align-items-center justify-content-between gap-2 mb-3"
        style={{ borderBottom: "1px solid #eee" }}
      >
        <div className="d-flex flex-column">
          <h1 className="h5 m-0">Track your deliveries</h1>
          <small className="text-muted">
            You'll see your delivery orders until they're marked as <strong>delivered</strong>.
          </small>
        </div>
        <button className="btn btn-outline-secondary btn-sm" onClick={() => refresh()}>
            Refresh
        </button>
      </div>

      {!authReady && <div className="text-muted">Initializing session…</div>}
      {authReady && !user && <div className="text-danger">Sign in to see your orders.</div>}
      {error && <div className="text-danger">{error}</div>}
      {user && loading && <div className="text-muted">Loading orders…</div>}

      {user && (
        <>
          {orders.length === 0 ? (
            <div className="alert alert-light">You have no deliveries in progress right now.</div>
          ) : (
            <div className="row g-3">
              {orders.map((o) => (
                <div key={o.id} className="col-12 col-md-6 col-lg-5 col-xl-4">
                  <OrderTrackingCard o={o} />
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* Export protegido */
export default function TrackingPage() {
  return (
    <Protected>
      <TrackingPageInner />
    </Protected>
  );
}
