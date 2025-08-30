// src/app/admin/orders/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
// Si ya tienes este guard y deseas aplicarlo, descomenta la línea de abajo:
// import { OnlyAdmin } from "@/components/Only";

type FirestoreTimestamp =
  | { seconds: number; nanoseconds: number } // cuando viene serializado
  | Date                                     // por si ya está convertido
  | null
  | undefined;

type OrderDoc = {
  id: string;
  type?: "dine_in" | "takeaway" | "delivery";
  status?: string;
  currency?: string;
  tableNumber?: string | null;
  notes?: string | null;
  createdAt?: FirestoreTimestamp;
  updatedAt?: FirestoreTimestamp;
  createdBy?: { uid?: string; email?: string | null } | null;
  userEmail?: string | null;
  items?: any[]; // formato OPS
  amounts?: { subtotal: number; tax?: number; serviceFee?: number; discount?: number; tip?: number; total: number } | null;
  lines?: Array<{ totalCents?: number }>; // legacy
  totals?: { totalCents?: number } | null; // legacy
  channel?: string;
  origin?: string;
};

type ApiListResponse = { ok?: boolean; orders?: OrderDoc[]; error?: string };

function tsToDate(ts: FirestoreTimestamp): Date | null {
  if (!ts) return null;
  if (ts instanceof Date) return ts;
  if (typeof (ts as any)?.toDate === "function") return (ts as any).toDate();
  if (typeof (ts as any)?.seconds === "number") {
    return new Date((ts as any).seconds * 1000);
  }
  return null;
}

function formatDate(ts: FirestoreTimestamp): string {
  const d = tsToDate(ts);
  if (!d) return "-";
  // Fecha y hora locales
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString()}`;
}

function isClosed(status?: string): boolean {
  const s = (status || "").toLowerCase();
  return s === "closed" || s === "cancelled";
}

function formatMoney(order: OrderDoc): string {
  // OPS
  if (order.amounts && typeof order.amounts.total === "number") {
    const cur = (order.currency || "GTQ").toUpperCase();
    const symbol = cur === "GTQ" ? "Q" : cur === "USD" ? "$" : `${cur} `;
    return `${symbol}${order.amounts.total.toFixed(2)}`;
  }
  // LEGACY
  const cents =
    (order.totals?.totalCents ?? null) != null
      ? order.totals!.totalCents!
      : Array.isArray(order.lines)
      ? order.lines.reduce((acc, l) => acc + (l.totalCents || 0), 0)
      : 0;
  const cur = (order.currency || "GTQ").toUpperCase();
  const symbol = cur === "GTQ" ? "Q" : cur === "USD" ? "$" : `${cur} `;
  return `${symbol}${(cents / 100).toFixed(2)}`;
}

export default function AdminOrdersPage() {
  const [orders, setOrders] = useState<OrderDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [emailFilter, setEmailFilter] = useState("");

  useEffect(() => {
    let isMounted = true;
    (async () => {
      try {
        setLoading(true);
        const res = await fetch(`/api/orders?limit=100`, { cache: "no-store" });
        const data: ApiListResponse = await res.json();
        if (!res.ok || !data.ok) {
          throw new Error(data?.error || `HTTP ${res.status}`);
        }
        if (isMounted) setOrders(data.orders || []);
      } catch (e: any) {
        if (isMounted) setErr(e?.message || "Error cargando órdenes");
      } finally {
        if (isMounted) setLoading(false);
      }
    })();
    return () => {
      isMounted = false;
    };
  }, []);

  const filtered = useMemo(() => {
    const q = emailFilter.trim().toLowerCase();
    if (!q) return orders;
    return orders.filter((o) => {
      const a = (o.userEmail || "").toLowerCase();
      const b = (o.createdBy?.email || "").toLowerCase();
      return a.includes(q) || b.includes(q);
    });
  }, [orders, emailFilter]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const da = tsToDate(a.createdAt)?.getTime() ?? 0;
      const db = tsToDate(b.createdAt)?.getTime() ?? 0;
      return db - da; // descendente
    });
  }, [filtered]);

  return (
    // Si usas guard de admin, coloca <OnlyAdmin> aquí:
    // <OnlyAdmin>
    <div className="container py-4">
      <div className="d-flex align-items-center justify-content-between mb-3">
        <h1 className="h4 m-0">Orders (Admin)</h1>
        <span className="text-muted">Total: {sorted.length}</span>
      </div>

      <div className="card mb-4 shadow-sm">
        <div className="card-body">
          <div className="row g-2 align-items-end">
            <div className="col-12 col-md-6">
              <label htmlFor="emailFilter" className="form-label mb-1">
                Filtrar por correo de usuario
              </label>
              <div className="input-group">
                <span className="input-group-text">@</span>
                <input
                  id="emailFilter"
                  type="text"
                  className="form-control"
                  placeholder="usuario@correo.com"
                  value={emailFilter}
                  onChange={(e) => setEmailFilter(e.target.value)}
                />
                {emailFilter && (
                  <button
                    className="btn btn-outline-secondary"
                    type="button"
                    onClick={() => setEmailFilter("")}
                    title="Limpiar"
                  >
                    Limpiar
                  </button>
                )}
              </div>
              <div className="form-text">
                Busca en <code>userEmail</code> o <code>createdBy.email</code>.
              </div>
            </div>
          </div>
        </div>
      </div>

      {loading && (
        <div className="alert alert-info">Cargando órdenes…</div>
      )}
      {err && (
        <div className="alert alert-danger">Error: {err}</div>
      )}

      {!loading && !err && (
        <ul className="list-group">
          {sorted.map((o) => {
            const closed = isClosed(o.status);
            const pillClass = closed ? "bg-danger" : "bg-primary";
            const statusLabel = (o.status || "-").toUpperCase();
            const email = o.userEmail || o.createdBy?.email || "-";
            const typeLabel =
              o.type === "dine_in"
                ? "Dine-In"
                : o.type === "takeaway"
                ? "Takeaway"
                : o.type === "delivery"
                ? "Delivery"
                : "-";

            return (
              <li
                key={o.id}
                className="list-group-item d-flex flex-column flex-md-row align-items-start align-items-md-center justify-content-between"
              >
                <div className="me-3">
                  <div className="fw-semibold">
                    <span className="me-2">#{o.id.slice(0, 6)}</span>
                    <span className={`badge rounded-pill ${pillClass} me-2`}>{statusLabel}</span>
                    <span className="badge text-bg-light">{typeLabel}</span>
                  </div>
                  <div className="small text-muted mt-1">
                    Creada: {formatDate(o.createdAt)} • Mesa: {o.tableNumber || "-"}
                  </div>
                  <div className="small mt-1">
                    <span className="text-muted">Usuario: </span>
                    <span>{email}</span>
                  </div>
                </div>

                <div className="text-md-end mt-2 mt-md-0">
                  <div className="fw-bold">{formatMoney(o)}</div>
                  {o.notes ? (
                    <div className="small text-muted text-wrap" style={{ maxWidth: 420 }}>
                      Nota: {o.notes}
                    </div>
                  ) : null}
                </div>
              </li>
            );
          })}
          {sorted.length === 0 && (
            <li className="list-group-item text-center text-muted">
              No hay órdenes que coincidan con el filtro.
            </li>
          )}
        </ul>
      )}
    </div>
    // </OnlyAdmin>
  );
}
