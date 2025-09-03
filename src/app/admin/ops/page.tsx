'use client';

import { useEffect, useMemo, useState } from 'react';

import {
  getFirestore,
  collection,
  onSnapshot,
  orderBy,
  query,
} from 'firebase/firestore';
import Protected from '@/components/Protected';
import AdminOnly from '@/components/AdminOnly';

import OrderCardOps, { type OpsOrder } from '@/components/admin/ops/OrderCardOps';
import { ACTIVE_STATUSES, isActive, isCancelled, isClosed, statusLabel } from '@/lib/orders/status';

type FilterKey = 'all' | 'active' | 'closed' | 'cancelled';

function useOrdersForOps(db: ReturnType<typeof getFirestore>) {
  const [rows, setRows] = useState<OpsOrder[]>([]);
  useEffect(() => {
    const q = query(collection(db, 'orders'), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(q, (snap) => {
      const list: OpsOrder[] = snap.docs.map((d) => {
        const data = d.data() as any;
        return {
          id: d.id,
          number: data?.number,
          status: data?.status,
          items: Array.isArray(data?.items) ? data.items : [],
          orderTotal: Number(data?.orderTotal || 0),
          orderInfo: data?.orderInfo,
          createdAt: data?.createdAt,
          updatedAt: data?.updatedAt,
        };
      });
      setRows(list);
    });
    return () => unsub();
  }, [db]);
  return rows;
}

export default function AdminOpsPage() {
  const db = getFirestore();
  const orders = useOrdersForOps(db);

  const [filter, setFilter] = useState<FilterKey>('all');
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    let list = orders;

    if (filter === 'active') list = orders.filter((o) => isActive(o.status || ''));
    if (filter === 'closed') list = orders.filter((o) => isClosed(o.status || ''));
    if (filter === 'cancelled') list = orders.filter((o) => isCancelled(o.status || ''));

    // 👇 Cambio mínimo: ocultar cerradas por defecto (incluye "Todas"),
    // solo se muestran cuando el filtro es exactamente "closed".
    if (filter !== 'closed') {
      list = list.filter((o) => !isClosed(o.status || ''));
    }

    if (search.trim()) {
      const s = search.trim().toLowerCase();
      list = list.filter((o) => {
        const num = (o.number !== undefined && o.number !== null) ? String(o.number) : o.id.slice(0, 6);
        const hayInfo = JSON.stringify(o.orderInfo || {}).toLowerCase();
        const hayItems = (o.items || []).some((ln) =>
          String(ln.menuItemName || '').toLowerCase().includes(s)
        );
        return (
          num.toLowerCase().includes(s) ||
          (o.status && statusLabel(o.status).toLowerCase().includes(s)) ||
          hayInfo.includes(s) ||
          hayItems
        );
      });
    }
    return list;
  }, [orders, filter, search]);

  return (
    <Protected>
      <AdminOnly>
    <div className="container py-4">
      <div className="d-flex flex-wrap align-items-center justify-content-between mb-3 gap-2">
        <h1 className="h4 m-0">Ops — Órdenes</h1>

        <div className="d-flex gap-2">
          <div className="btn-group" role="group" aria-label="Filtros">
            <button
              className={`btn btn-sm ${filter==='all' ? 'btn-primary' : 'btn-outline-primary'}`}
              onClick={() => setFilter('all')}
            >
              Todas
            </button>
            <button
              className={`btn btn-sm ${filter==='active' ? 'btn-primary' : 'btn-outline-primary'}`}
              onClick={() => setFilter('active')}
            >
              Activas
            </button>
            <button
              className={`btn btn-sm ${filter==='closed' ? 'btn-primary' : 'btn-outline-primary'}`}
              onClick={() => setFilter('closed')}
            >
              Cerradas
            </button>
            <button
              className={`btn btn-sm ${filter==='cancelled' ? 'btn-primary' : 'btn-outline-primary'}`}
              onClick={() => setFilter('cancelled')}
            >
              Canceladas
            </button>
          </div>

          <input
            className="form-control form-control-sm"
            placeholder="Buscar (número, estado, mesa, dirección, plato...)"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ minWidth: 260 }}
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="alert alert-light border">No hay órdenes para mostrar.</div>
      ) : (
        <div className="row g-3">
          {filtered.map((ord) => (
            <div className="col-12 col-md-6 col-xl-4" key={ord.id}>
              <OrderCardOps db={db} order={ord} />
            </div>
          ))}
        </div>
      )}
    </div>
     </AdminOnly>
    </Protected>
  );
}
