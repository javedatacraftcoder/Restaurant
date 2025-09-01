'use client';

import React, { useMemo, useState } from 'react';
import { useNewCart } from '@/lib/newcart/context';
import type { DineInInfo, DeliveryInfo } from '@/lib/newcart/types';
import { useRouter } from 'next/navigation';

// Firestore
import { getFirestore, collection, addDoc, serverTimestamp } from 'firebase/firestore';

function fmtQ(n?: number) {
  const v = Number.isFinite(Number(n)) ? Number(n) : 0;
  try { return new Intl.NumberFormat('es-GT', { style: 'currency', currency: 'GTQ' }).format(v); }
  catch { return `Q ${v.toFixed(2)}`; }
}

export default function CheckoutNewPage() {
  const cart = useNewCart();
  const grand = useMemo(() => cart.computeGrandTotal(), [cart, cart.items]);

  const [mode, setMode] = useState<'dine-in' | 'delivery'>('dine-in');
  const [table, setTable] = useState('');
  const [notes, setNotes] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);

  const router = useRouter();
  const db = getFirestore();

  async function onSubmit() {
    const meta: DineInInfo | DeliveryInfo = mode === 'dine-in'
      ? { type: 'dine-in', table, notes: notes || undefined }
      : { type: 'delivery', address, phone, notes: notes || undefined };

    const orderPayload = {
      items: cart.items.map((ln) => ({
        menuItemId: ln.menuItemId,
        menuItemName: ln.menuItemName,
        basePrice: ln.basePrice,
        quantity: ln.quantity,
        addons: ln.addons.map(a => ({ name: a.name, price: a.price })),
        optionGroups: ln.optionGroups.map(g => ({
          groupId: g.groupId,
          groupName: g.groupName,
          type: g.type || 'single',
          items: g.items.map(it => ({ id: it.id, name: it.name, priceDelta: it.priceDelta })),
        })),
        lineTotal: cart.computeLineTotal(ln),
      })),
      orderTotal: grand,
      orderInfo: meta,
      status: 'pending',               // opcional: para admin
      createdAt: serverTimestamp(),    // timestamp del servidor
    };

    try {
      setSaving(true);
      const ref = await addDoc(collection(db, 'orders'), orderPayload);
      console.log('[CHECKOUT] Orden guardada en orders con id:', ref.id);

      // Limpiamos carrito y redirigimos (o mostrar gracias)
      cart.clear();
      router.push('/cart-new'); // o '/menu' o una página de "gracias"
      alert('¡Orden creada! ID: ' + ref.id);
    } catch (err) {
      console.error('Error guardando la orden:', err);
      alert('No se pudo guardar la orden. Intenta nuevamente.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="container py-4">
      <h1 className="h4 mb-3">Checkout (nuevo)</h1>

      <div className="row g-4">
        <div className="col-12 col-lg-7">
          <div className="card border-0 shadow-sm">
            <div className="card-header"><div className="fw-semibold">Detalles</div></div>
            <div className="card-body">
              <div className="mb-3">
                <label className="form-label fw-semibold">Tipo de pedido</label>
                <div className="d-flex gap-2">
                  <button
                    className={`btn ${mode === 'dine-in' ? 'btn-primary' : 'btn-outline-primary'}`}
                    onClick={() => setMode('dine-in')}
                    disabled={saving}
                  >
                    Dine-in
                  </button>
                  <button
                    className={`btn ${mode === 'delivery' ? 'btn-primary' : 'btn-outline-primary'}`}
                    onClick={() => setMode('delivery')}
                    disabled={saving}
                  >
                    Delivery
                  </button>
                </div>
              </div>

              {mode === 'dine-in' ? (
                <>
                  <div className="mb-3">
                    <label className="form-label">Mesa</label>
                    <input className="form-control" value={table} onChange={e => setTable(e.target.value)} placeholder="Ej. Mesa 5" disabled={saving} />
                  </div>
                  <div className="mb-3">
                    <label className="form-label">Notas (opcional)</label>
                    <textarea className="form-control" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Instrucciones adicionales" disabled={saving} />
                  </div>
                </>
              ) : (
                <>
                  <div className="mb-3">
                    <label className="form-label">Dirección</label>
                    <input className="form-control" value={address} onChange={e => setAddress(e.target.value)} placeholder="Ej. 5a avenida 10-11..." disabled={saving} />
                  </div>
                  <div className="mb-3">
                    <label className="form-label">Teléfono</label>
                    <input className="form-control" value={phone} onChange={e => setPhone(e.target.value)} placeholder="Ej. 5555-5555" disabled={saving} />
                  </div>
                  <div className="mb-3">
                    <label className="form-label">Notas (opcional)</label>
                    <textarea className="form-control" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Instrucciones adicionales" disabled={saving} />
                  </div>
                </>
              )}
            </div>
            <div className="card-footer">
              <button
                className="btn btn-primary"
                disabled={
                  saving ||
                  (mode === 'dine-in' ? !table : !(address && phone)) ||
                  cart.items.length === 0
                }
                onClick={onSubmit}
              >
                {saving ? 'Guardando…' : 'Confirmar pedido'}
              </button>
            </div>
          </div>
        </div>

        {/* Resumen */}
        <div className="col-12 col-lg-5">
          <div className="card border-0 shadow-sm">
            <div className="card-header"><div className="fw-semibold">Resumen</div></div>
            <div className="card-body">
              <div className="d-flex flex-column gap-3">
                {cart.items.map((ln, idx) => {
                  const unitExtras = cart.computeLineTotal({ ...ln, quantity: 1 }) - ln.basePrice;
                  const lineSum = cart.computeLineTotal(ln);
                  return (
                    <div key={`${ln.menuItemId}-${idx}`} className="border rounded p-2">
                      <div className="d-flex justify-content-between">
                        <div className="fw-semibold">{ln.menuItemName} <span className="text-muted">× {ln.quantity}</span></div>
                        <div className="fw-semibold">{fmtQ(lineSum)}</div>
                      </div>
                      {(ln.addons.length > 0 || ln.optionGroups.some(g => g.items.length > 0)) && (
                        <div className="mt-2">
                          {ln.addons.map((ad, i) => (
                            <div className="d-flex justify-content-between small" key={`ad-${idx}-${i}`}>
                              <div>— (addons) {ad.name}</div>
                              <div>{fmtQ(ad.price)}</div>
                            </div>
                          ))}
                          {ln.optionGroups.map((g) => g.items.map((it) => (
                            <div className="d-flex justify-content-between small" key={`gi-${idx}-${g.groupId}-${it.id}`}>
                              <div>— (groupitems) {it.name}</div>
                              <div>{fmtQ(it.priceDelta)}</div>
                            </div>
                          )))}
                        </div>
                      )}
                      <div className="text-muted small mt-1">({fmtQ(ln.basePrice + unitExtras)} c/u)</div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="card-footer d-flex justify-content-between">
              <div>Total</div>
              <div className="fw-semibold">{fmtQ(grand)}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
