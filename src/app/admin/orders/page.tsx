// src/app/admin/orders/page.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/app/providers";
import OrderStatusActions from "@/components/orders/OrderStatusActions";

type OrderRow = {
  id: string;
  type: 'dine_in' | 'delivery' | 'pickup' | 'assigned_to_courier' | 'on_the_way';
  status:
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
  totalCents: number;
  createdAt: string;
  updatedAt?: string;
  createdBy: string;
  customerName?: string;
};

type StatusLog = {
  id: string;
  at: string;   // ISO
  by: string;   // uid
  from: string; // status
  to: string;   // status
};

const STATUSES: OrderRow["status"][] = [
  "placed",
  "kitchen_in_progress",
  "kitchen_done",
  "ready_to_close",
  "assigned_to_courier",
  "on_the_way",
  "delivered",
  "closed",
  "cancelled",
];

const q = (cents: number) => `Q ${(cents / 100).toFixed(2)}`;

export default function AdminOrdersPage() {
  const { user, idToken, claims, flags, refreshRoles: refresh } = useAuth();
  const isAdmin = !!flags.isAdmin || !!claims?.admin || claims?.role === "admin";

  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [lastLogs, setLastLogs] = useState<Record<string, StatusLog | null>>({});
  const pollRef = useRef<NodeJS.Timeout | null>(null);

  const filtered = useMemo(() => orders, [orders]);

  async function fetchOrders(reset = false) {
    if (!idToken) return;
    setLoading(true);
    setErr(null);

    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set("status", statusFilter);
      params.set("limit", "20");
      if (!reset && cursor) params.set("cursor", cursor);

      const res = await fetch(`/api/orders?${params.toString()}`, {
        headers: { authorization: `Bearer ${idToken}` },
        cache: "no-store",
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error ?? `HTTP ${res.status}`);
      }
      const data = await res.json();
      const next = (data.items ?? []) as OrderRow[];
      setOrders(prev => (reset ? next : [...prev, ...next]));
      setCursor(data.nextCursor ?? null);

      const all = (reset ? next : [...orders, ...next]);
      const logEntries: Record<string, StatusLog | null> = {};
      await Promise.all(
        all.map(async (o) => {
          try {
            const r = await fetch(`/api/orders/${o.id}/status/logs?limit=1`, {
              headers: { authorization: `Bearer ${idToken}` },
              cache: "no-store",
            });
            if (!r.ok) { logEntries[o.id] = null; return; }
            const j = await r.json();
            logEntries[o.id] = (j.items?.[0] as StatusLog) ?? null;
          } catch {
            logEntries[o.id] = null;
          }
        })
      );
      setLastLogs(logEntries);
    } catch (e: any) {
      setErr(e?.message ?? "Error al cargar órdenes");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchOrders(true);
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(() => fetchOrders(true), 15000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idToken, statusFilter]);

  if (!user) {
    return (
      <div className="container py-4">
        <h1>Órdenes (Admin)</h1>
        <p>Debes iniciar sesión.</p>
      </div>
    );
  }
  if (!isAdmin) {
    return (
      <div className="container py-4">
        <h1>Órdenes (Admin)</h1>
        <p>No tienes permisos para ver esta página.</p>
        <button className="btn btn-outline-secondary btn-sm" onClick={refresh}>
          Refrescar roles
        </button>
      </div>
    );
  }

  return (
    <div className="container py-4">
      <h1 className="mb-3">Órdenes (Admin)</h1>

      <div className="d-flex gap-2 align-items-center mb-3">
        <label className="form-label m-0">Filtrar por estado:</label>
        <select
          className="form-select"
          style={{ maxWidth: 260 }}
          value={statusFilter}
          onChange={(e) => {
            setCursor(null);
            setStatusFilter(e.target.value);
          }}
        >
          <option value="">Todos</option>
          {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <button className="btn btn-outline-secondary" onClick={() => fetchOrders(true)} disabled={loading}>
          {loading ? "Actualizando…" : "Refrescar"}
        </button>
      </div>

      {err && <p style={{ color: "crimson" }}>{err}</p>}

      <div className="table-responsive">
        <table className="table table-sm table-striped align-middle">
          <thead>
            <tr>
              <th>ID</th>
              <th>Cliente</th>
              <th>Tipo</th>
              <th>Estado</th>
              <th>Último cambio</th>
              <th>Total</th>
              <th>Creado</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(o => {
              const last = lastLogs[o.id] ?? null;
              const lastText = last
                ? `${new Date(last.at).toLocaleString()} • ${last.from} → ${last.to} • by ${last.by}`
                : "—";
              return (
                <tr key={o.id}>
                  <td className="text-truncate" style={{ maxWidth: 200 }}>{o.id}</td>
                  <td>{o.customerName || "—"}</td>
                  <td>{o.type}</td>
                  <td><span className="badge text-bg-primary">{o.status}</span></td>
                  <td>
                    <span className="badge text-bg-secondary" title={lastText}>
                      {last ? `${new Date(last.at).toLocaleTimeString()} · ${last.to}` : "—"}
                    </span>
                  </td>
                  <td>{q(o.totalCents)}</td>
                  <td>{new Date(o.createdAt).toLocaleString()}</td>
                  <td className="d-flex flex-wrap gap-1">
                    <OrderStatusActions
                      orderId={o.id}
                      currentStatus={o.status}
                      role="admin"
                      compact
                      onTransition={() => {
                        // Tras cambiar de estado, recargamos la lista
                        fetchOrders(true);
                      }}
                    />
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && !loading && (
              <tr><td colSpan={8} className="text-center py-4">No hay órdenes</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="d-flex justify-content-center">
        <button className="btn btn-outline-primary" onClick={() => fetchOrders(false)} disabled={loading || !cursor}>
          {cursor ? "Cargar más" : "No hay más"}
        </button>
      </div>
    </div>
  );
}
