// src/app/orders/page.tsx
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/app/providers';
// CurrencyUpdate: reemplazar import de moneda fija por el formateador global
import { useFmtQ } from '@/lib/settings/money';

type OrderRow = {
  id: string;
  type: 'dine_in' | 'delivery';
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
  subtotalCents?: number;
  tipCents?: number;
  createdAt: string; // ISO
  updatedAt?: string; // ISO
};

export default function OrdersPage() {
  const { idToken } = useAuth();
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>(''); // estado opcional para filtrar por status en UI
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const filtered = useMemo(
    () => orders.filter(o => (filter ? o.status === filter : true)),
    [orders, filter]
  );

  // CurrencyUpdate: hook de formateo (usa currency/locale del SettingsProvider)
  const fmtQ = useFmtQ();

  async function load() {
    if (!idToken) return;
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch('/api/orders?limit=50', {
        headers: { Authorization: `Bearer ${idToken}` },
        cache: 'no-store',
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error ?? `HTTP ${res.status}`);
      }
      const data = await res.json();
      setOrders((data.items ?? []) as OrderRow[]);
    } catch (e: any) {
      setErr(e?.message ?? 'Error loading your orders');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // Auto-refresh cada 20s (opcional)
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      load();
    }, 20000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idToken]);

  return (
    <div className="container py-4">
      <div className="d-flex align-items-center justify-content-between mb-3">
        <h1 className="m-0">Mis pedidos</h1>
        <div className="d-flex gap-2">
          <select
            className="form-select form-select-sm"
            value={filter}
            onChange={e => setFilter(e.target.value)}
          >
            <option value="">Todos</option>
            <option value="placed">placed</option>
            <option value="kitchen_in_progress">kitchen_in_progress</option>
            <option value="kitchen_done">kitchen_done</option>
            <option value="ready_to_close">ready_to_close</option>
            <option value="assigned_to_courier">assigned_to_courier</option>
            <option value="on_the_way">on_the_way</option>
            <option value="delivered">delivered</option>
            <option value="closed">closed</option>
            <option value="cancelled">cancelled</option>
          </select>
          <button className="btn btn-outline-primary btn-sm" onClick={load} disabled={loading || !idToken}>
            {loading ? 'Updating…' : 'Update'}
          </button>
        </div>
      </div>

      {!idToken && (
        <p>
          You must <a href="/login">sign in</a> to view your orders.
        </p>
      )}

      {idToken && (
        <>
          {err && <p style={{ color: 'crimson' }}>{err}</p>}
          {loading && !orders.length && <p>Loading…</p>}

          <div className="table-responsive">
            <table className="table table-sm align-middle">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Total</th>
                  <th>Created</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(o => (
                  <tr key={o.id}>
                    <td className="text-truncate" style={{ maxWidth: 240 }}>{o.id}</td>
                    <td>{o.type}</td>
                    <td>
                      <span className="badge text-bg-primary">{o.status}</span>
                    </td>
                    {/* CurrencyUpdate: totalCents -> dividir entre 100 y formatear */}
                    <td>{fmtQ(o.totalCents / 100)}</td>
                    <td>{o.createdAt ? new Date(o.createdAt).toLocaleString() : '-'}</td>
                    <td>{o.updatedAt ? new Date(o.updatedAt).toLocaleString() : '-'}</td>
                  </tr>
                ))}
                {filtered.length === 0 && !loading && (
                  <tr>
                    <td colSpan={6} className="text-center py-4">
                      {filter ? 'There are no orders with that status' : 'You have no orders.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="mt-3">
            <a className="btn btn-outline-secondary" href="/menu">
              Volver al Menú
            </a>
          </div>
        </>
      )}
    </div>
  );
}
