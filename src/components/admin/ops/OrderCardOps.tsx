'use client';

import { useMemo, useState } from 'react';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import type { OrderStatus } from '@/lib/orders/status';
import { ORDER_STATUSES, statusLabel } from '@/lib/orders/status';

type Addon = { name: string; price: number };
type OptionItem = { id: string; name: string; priceDelta: number };
type OptionGroup = { groupId: string; groupName: string; type?: 'single' | 'multi'; items: OptionItem[] };
type OrderItem = {
  menuItemId: string;
  menuItemName: string;
  basePrice: number;
  quantity: number;
  addons: Addon[];
  optionGroups: OptionGroup[];
  lineTotal?: number;
};

type OrderInfoDineIn = { type: 'dine-in'; table?: string; notes?: string };
type OrderInfoDelivery = { type: 'delivery'; address?: string; phone?: string; notes?: string };
type OrderInfo = OrderInfoDineIn | OrderInfoDelivery;

export type OpsOrder = {
  id: string;
  number?: string | number; // si lo tienes; si no, usamos id cortado
  status?: OrderStatus | string;
  items: OrderItem[];
  orderTotal?: number;
  orderInfo?: OrderInfo;
  createdAt?: any; // Firestore Timestamp | string
  updatedAt?: any;
};

function fmtQ(n?: number) {
  const v = Number(n || 0);
  try { return new Intl.NumberFormat('es-GT', { style: 'currency', currency: 'GTQ' }).format(v); }
  catch { return `Q ${v.toFixed(2)}`; }
}

function fmtDate(ts?: any) {
  if (!ts) return '—';
  try {
    // Soporta tanto Timestamp de Firestore como ISO string
    const d = typeof ts?.toDate === 'function' ? ts.toDate() : new Date(ts);
    return d.toLocaleString('es-GT', { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return String(ts);
  }
}

export default function OrderCardOps({
  db,
  order,
}: {
  db: import('firebase/firestore').Firestore;
  order: OpsOrder;
}) {
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<OrderStatus | string>(order.status || 'placed');

  const orderNumber = useMemo(() => {
    if (order.number !== undefined && order.number !== null && String(order.number).trim() !== '') {
      return String(order.number);
    }
    // fallback: parte inicial del id
    return order.id.slice(0, 6).toUpperCase();
  }, [order.id, order.number]);

  const info = order.orderInfo || ({} as OrderInfo);

  // Render de items con precios
  const itemsWithPricing = (
    <div className="d-flex flex-column gap-2">
      {order.items.map((ln, idx) => {
        const unitExtras =
          (ln.addons || []).reduce((a, x) => a + Number(x.price || 0), 0) +
          (ln.optionGroups || []).reduce(
            (ga, g) => ga + (g.items || []).reduce((ia, it) => ia + Number(it.priceDelta || 0), 0),
            0
          );
        const unitTotal = Number(ln.basePrice || 0) + unitExtras;
        const lineTotal = typeof ln.lineTotal === 'number' ? ln.lineTotal : unitTotal * (ln.quantity || 1);

        return (
          <div className="border rounded p-2" key={`${ln.menuItemId}-${idx}`}>
            <div className="d-flex justify-content-between">
              <div className="fw-semibold">
                {ln.menuItemName} <span className="text-muted">× {ln.quantity}</span>
              </div>
              <div className="fw-semibold">{fmtQ(lineTotal)}</div>
            </div>

            {(ln.addons?.length || ln.optionGroups?.some(g => g.items?.length)) && (
              <div className="mt-1">
                {(ln.addons || []).map((ad, i) => (
                  <div className="d-flex justify-content-between small" key={`ad-${idx}-${i}`}>
                    <div>— (addons) {ad.name}</div>
                    <div>{fmtQ(ad.price)}</div>
                  </div>
                ))}
                {(ln.optionGroups || []).map((g) =>
                  (g.items || []).map((it) => (
                    <div className="d-flex justify-content-between small" key={`gi-${idx}-${g.groupId}-${it.id}`}>
                      <div>— (groupitems) {it.name}</div>
                      <div>{fmtQ(it.priceDelta)}</div>
                    </div>
                  ))
                )}
              </div>
            )}

            <div className="text-muted small mt-1">({fmtQ(unitTotal)} c/u)</div>
          </div>
        );
      })}
      <div className="d-flex justify-content-between border-top pt-2">
        <div className="fw-semibold">Total</div>
        <div className="fw-semibold">{fmtQ(order.orderTotal)}</div>
      </div>
    </div>
  );

  async function onSaveStatus() {
    try {
      setSaving(true);
      await updateDoc(doc(db, 'orders', order.id), {
        status,
        updatedAt: serverTimestamp(),
      });
      // Sin toast aquí para mantener el estilo simple; puedes agregar uno si usas lib de toasts
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card border-0 shadow-sm">
      <div className="card-header d-flex flex-wrap align-items-center justify-content-between">
        <div className="d-flex flex-column">
          <div className="fw-semibold">Orden #{orderNumber}</div>
          <div className="text-muted small">Creada: {fmtDate(order.createdAt)}</div>
        </div>

        <div className="text-end small">
          <div className="mb-1">
            <span className="badge text-bg-secondary">{statusLabel(order.status)}</span>
          </div>
          {info?.type === 'dine-in' ? (
            <div>
              <div className="fw-semibold">Dine-in</div>
              {info.table ? <div>Mesa: {info.table}</div> : null}
              {info.notes ? <div className="text-muted">Nota: {info.notes}</div> : null}
            </div>
          ) : info?.type === 'delivery' ? (
            <div>
              <div className="fw-semibold">Delivery</div>
              {info.address ? <div>Dir: {info.address}</div> : null}
              {info.phone ? <div>Tel: {info.phone}</div> : null}
              {info.notes ? <div className="text-muted">Nota: {info.notes}</div> : null}
            </div>
          ) : null}
        </div>
      </div>

      <div className="card-body">
        {itemsWithPricing}

        <div className="mt-3">
          <label className="form-label fw-semibold">Cambiar estado</label>
          <div className="d-flex gap-2">
            <select
              className="form-select"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              disabled={saving}
            >
              {ORDER_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {statusLabel(s)}
                </option>
              ))}
            </select>
            <button className="btn btn-primary" onClick={onSaveStatus} disabled={saving}>
              {saving ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
        </div>
      </div>

      {order.updatedAt ? (
        <div className="card-footer text-muted small">
          Última actualización: {fmtDate(order.updatedAt)}
        </div>
      ) : null}
    </div>
  );
}
