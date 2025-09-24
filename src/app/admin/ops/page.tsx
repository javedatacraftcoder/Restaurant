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
import { isActive, isCancelled, isClosed, statusLabel } from '@/lib/orders/status';
import { getActiveTaxProfile, type TaxProfile } from '@/lib/tax/profile';

type FilterKey = 'all' | 'active' | 'closed' | 'cancelled';

function okPayStatus(s: any) {
  return ['paid', 'captured', 'completed', 'succeeded', 'approved'].includes(
    String(s || '').toLowerCase()
  );
}

/**
 * Carga y mapea pedidos para Ops.
 * Fallback de currency: taxSnapshot.currency -> totalsCents.currency -> order.currency -> payment.currency -> defaultCurrency -> 'USD'
 */
function useOrdersForOps(
  db: ReturnType<typeof getFirestore>,
  defaultCurrency?: string
) {
  const [rows, setRows] = useState<OpsOrder[]>([]);

  useEffect(() => {
    const q = query(collection(db, 'orders'), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(q, (snap) => {
      const list: OpsOrder[] = snap.docs.map((d) => {
        const data = d.data() as any;

        const paidByPaypal =
          (data?.payment?.provider === 'paypal' && okPayStatus(data?.payment?.status)) ||
          (Array.isArray(data?.payments) &&
            data.payments.some((p: any) => p?.provider === 'paypal' && okPayStatus(p?.status))) ||
          (String(data?.paymentProvider || '').toLowerCase() === 'paypal' && okPayStatus(data?.paymentStatus));

        // 👇 Resolución robusta de currency
        const currency: string =
          data?.taxSnapshot?.currency ||
          data?.totalsCents?.currency ||
          data?.currency ||
          data?.payment?.currency ||
          defaultCurrency ||
          'USD';

        // Totales en centavos si existen
        const totalsCents =
          data?.totalsCents && typeof data.totalsCents === 'object'
            ? {
                subTotalCents:
                  Number(
                    data?.totalsCents?.subTotalCents ??
                      data?.taxSnapshot?.totals?.subTotalCents ??
                      0
                  ) || undefined,
                taxCents:
                  Number(
                    data?.totalsCents?.taxCents ??
                      data?.taxSnapshot?.totals?.taxCents ??
                      0
                  ) || undefined,
                serviceCents:
                  Number(
                    data?.totalsCents?.serviceCents ??
                      data?.taxSnapshot?.totals?.serviceCents ??
                      0
                  ) || undefined,
                grandTotalWithTaxCents:
                  Number(
                    data?.totalsCents?.grandTotalWithTaxCents ??
                      data?.taxSnapshot?.totals?.grandTotalWithTaxCents ??
                      0
                  ) || undefined,
                currency, // para referencia
              }
            : undefined;

        return {
          id: d.id,
          number: data?.number,
          status: data?.status,
          items: Array.isArray(data?.items) ? data.items : [],
          orderTotal: Number(
            data?.orderTotal ??
              data?.totals?.grandTotalWithTax ??
              0
          ), // legado (decimal)
          orderInfo: data?.orderInfo,
          createdAt: data?.createdAt,
          updatedAt: data?.updatedAt,

          currency,
          totalsCents,

          paidByPaypal,
        } as OpsOrder;
      });

      setRows(list);
    });

    return () => unsub();
  }, [db, defaultCurrency]);

  return rows;
}

export default function AdminOpsPage() {
  const db = getFirestore();

  // 👇 Traemos el perfil activo para usar su currency como fallback
  const [activeProfile, setActiveProfile] = useState<TaxProfile | null>(null);
  useEffect(() => {
    (async () => {
      try {
        const p = await getActiveTaxProfile();
        setActiveProfile(p || null);
      } catch {
        setActiveProfile(null);
      }
    })();
  }, []);

  const defaultCurrency = activeProfile?.currency || 'USD';
  const orders = useOrdersForOps(db, defaultCurrency);

  const [filter, setFilter] = useState<FilterKey>('all');
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    let list = orders;

    if (filter === 'active') list = orders.filter((o) => isActive(o.status || ''));
    if (filter === 'closed') list = orders.filter((o) => isClosed(o.status || ''));
    if (filter === 'cancelled') list = orders.filter((o) => isCancelled(o.status || ''));

    // Ocultar cerradas por defecto
    if (filter !== 'closed') {
      list = list.filter((o) => !isClosed(o.status || ''));
    }

    if (search.trim()) {
      const s = search.trim().toLowerCase();
      list = list.filter((o) => {
        const num =
          o.number !== undefined && o.number !== null ? String(o.number) : o.id.slice(0, 6);
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
            <h1 className="h4 m-0">Ops — Orders</h1>

            <div className="d-flex gap-2">
              <div className="btn-group" role="group" aria-label="Filters">
                <button
                  className={`btn btn-sm ${filter === 'all' ? 'btn-primary' : 'btn-outline-primary'}`}
                  onClick={() => setFilter('all')}
                >
                  All
                </button>
                <button
                  className={`btn btn-sm ${filter === 'active' ? 'btn-primary' : 'btn-outline-primary'}`}
                  onClick={() => setFilter('active')}
                >
                  Active
                </button>
                <button
                  className={`btn btn-sm ${filter === 'closed' ? 'btn-primary' : 'btn-outline-primary'}`}
                  onClick={() => setFilter('closed')}
                >
                  Closed
                </button>
                <button
                  className={`btn btn-sm ${filter === 'cancelled' ? 'btn-primary' : 'btn-outline-primary'}`}
                  onClick={() => setFilter('cancelled')}
                >
                  Cancelled
                </button>
              </div>

              <input
                className="form-control form-control-sm"
                placeholder="Search (number, status, table, address, dish...)"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ minWidth: 260 }}
              />
            </div>
          </div>

          {filtered.length === 0 ? (
            <div className="alert alert-light border">No orders to show.</div>
          ) : (
            <div className="row g-3">
              {filtered.map((ord) => (
                <div className="col-12 col-md-6 col-xl-4" key={ord.id}>
                  <div className="position-relative">
                    {(ord as any).paidByPaypal && (
                      <span
                        className="badge bg-info text-dark position-absolute"
                        style={{ right: 8, top: 8, zIndex: 2 }}
                      >
                        PayPal
                      </span>
                    )}
                    <OrderCardOps db={db} order={ord} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </AdminOnly>
    </Protected>
  );
}
