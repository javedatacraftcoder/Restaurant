// src/app/(client)/checkout-new/page.tsx
'use client';

import React, { useMemo, useState, useEffect } from 'react';
import { useNewCart } from '@/lib/newcart/context';
import type { DineInInfo, DeliveryInfo } from '@/lib/newcart/types';
import { useRouter } from 'next/navigation';

// Firestore
import { getFirestore, collection, addDoc, serverTimestamp } from 'firebase/firestore';
// Leer usuario actual para tomar su email (si hay sesión)
import { getAuth } from 'firebase/auth';

function fmtQ(n?: number) {
  const v = Number.isFinite(Number(n)) ? Number(n) : 0;
  try { return new Intl.NumberFormat('es-GT', { style: 'currency', currency: 'GTQ' }).format(v); }
  catch { return `Q ${v.toFixed(2)}`; }
}

type Addr = {
  line1?: string;
  city?: string;
  country?: string;
  zip?: string;
  notes?: string;
};

export default function CheckoutNewPage() {
  const cart = useNewCart();
  const grand = useMemo(() => cart.computeGrandTotal(), [cart, cart.items]);

  const [mode, setMode] = useState<'dine-in' | 'delivery'>('dine-in');
  const [table, setTable] = useState('');
  const [notes, setNotes] = useState('');

  // Dirección / Teléfono (UI)
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  // Datos del usuario (para dropdown y payload extra)
  const [customerName, setCustomerName] = useState<string>('');
  const [homeAddr, setHomeAddr] = useState<Addr | null>(null);
  const [officeAddr, setOfficeAddr] = useState<Addr | null>(null);
  const [addressLabel, setAddressLabel] = useState<'' | 'home' | 'office'>('');

  const [saving, setSaving] = useState(false);

  const router = useRouter();
  const db = getFirestore();

  // Cargar datos del cliente para prellenar teléfono y direcciones
  useEffect(() => {
    const run = async () => {
      try {
        const auth = getAuth();
        const u = auth.currentUser;
        if (!u) return;
        const token = await u.getIdToken();
        const res = await fetch('/api/customers/me', {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        });
        if (!res.ok) return;
        const data = await res.json();
        const c = data?.customer;
        if (!c) return;

        setCustomerName(c.displayName || u.displayName || '');

        if (c.phone && !phone) setPhone(c.phone);

        const h: Addr | null = c.addresses?.home || null;
        const o: Addr | null = c.addresses?.office || null;
        setHomeAddr(h);
        setOfficeAddr(o);

        const hasHome = !!(h && h.line1 && String(h.line1).trim());
        const hasOffice = !!(o && o.line1 && String(o.line1).trim());
        if (hasHome) {
          setAddressLabel('home');
          setAddress(String(h!.line1));
        } else if (hasOffice) {
          setAddressLabel('office');
          setAddress(String(o!.line1));
        }
      } catch {
        // Silencioso
      }
    };
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hasDropdown =
    (homeAddr && homeAddr.line1 && String(homeAddr.line1).trim() !== '') ||
    (officeAddr && officeAddr.line1 && String(officeAddr.line1).trim() !== '');

  function onChangeAddressLabel(value: 'home' | 'office') {
    setAddressLabel(value);
    const src = value === 'home' ? homeAddr : officeAddr;
    setAddress(src?.line1 ? String(src.line1) : '');
  }

  async function onSubmit() {
    const meta: DineInInfo | DeliveryInfo = mode === 'dine-in'
      ? { type: 'dine-in', table, notes: notes || undefined }
      : { type: 'delivery', address, phone, notes: notes || undefined };

    // Tomar email/uid del usuario si está autenticado
    const auth = getAuth();
    const u = auth.currentUser;
    const userEmail = u?.email || undefined;
    const uid = u?.uid || undefined;

    // Extra de orderInfo SOLO para delivery (no rompe nada existente)
    let orderInfo: any = meta;
    if (mode === 'delivery') {
      const selectedAddr = addressLabel === 'home' ? homeAddr
                        : addressLabel === 'office' ? officeAddr
                        : null;
      const addressInfo = selectedAddr ? {
        line1: selectedAddr.line1 || '',
        city: selectedAddr.city || '',
        country: selectedAddr.country || '',
        zip: selectedAddr.zip || '',
        notes: selectedAddr.notes || '',
      } : undefined;

      orderInfo = {
        ...(meta as DeliveryInfo),
        delivery: 'pending', // ya lo tenías
        customerName: customerName || u?.displayName || undefined,
        addressLabel: addressLabel || undefined,
        addressInfo, // objeto completo de la dirección elegida
        addressNotes: selectedAddr?.notes || undefined, // ⭐ addressNotes (solo delivery)
      };
    }

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

      // estructura original + campos extra para delivery
      orderInfo,

      status: 'placed',
      createdAt: serverTimestamp(),

      userEmail: userEmail,
      userEmail_lower: userEmail ? userEmail.toLowerCase() : undefined,
      createdBy: (uid || userEmail) ? { uid, email: userEmail ?? null } : undefined,
    };

    try {
      setSaving(true);
      const ref = await addDoc(collection(db, 'orders'), orderPayload);
      console.log('[CHECKOUT] Orden guardada en orders con id:', ref.id);

      cart.clear();
      router.push('/cart-new'); // o '/menu'
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
                    {hasDropdown ? (
                      <>
                        <select
                          className="form-select"
                          value={addressLabel || ''}
                          onChange={(e) => onChangeAddressLabel(e.target.value as 'home' | 'office')}
                          disabled={saving}
                        >
                          {homeAddr?.line1 && String(homeAddr.line1).trim() !== '' && (
                            <option value="home">Casa — {homeAddr.line1}</option>
                          )}
                          {officeAddr?.line1 && String(officeAddr.line1).trim() !== '' && (
                            <option value="office">Oficina — {officeAddr.line1}</option>
                          )}
                        </select>
                        {addressLabel && (
                          <div className="form-text">
                            {addressLabel === 'home' ? (
                              <>
                                {homeAddr?.city ? `Ciudad: ${homeAddr.city}. ` : ''}
                                {homeAddr?.zip ? `ZIP: ${homeAddr.zip}. ` : ''}
                                {homeAddr?.notes ? `Notas: ${homeAddr.notes}.` : ''}
                              </>
                            ) : (
                              <>
                                {officeAddr?.city ? `Ciudad: ${officeAddr.city}. ` : ''}
                                {officeAddr?.zip ? `ZIP: ${officeAddr.zip}. ` : ''}
                                {officeAddr?.notes ? `Notas: ${officeAddr.notes}.` : ''}
                              </>
                            )}
                          </div>
                        )}
                      </>
                    ) : (
                      <input
                        className="form-control"
                        value={address}
                        onChange={e => setAddress(e.target.value)}
                        placeholder="Ej. 5a avenida 10-11..."
                        disabled={saving}
                      />
                    )}
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
              {/* Bloque de resumen de entrega con alias y contacto */}
              {mode === 'delivery' && (
                <div className="border rounded p-2 mb-3 bg-light">
                  <div className="small text-muted">Entrega</div>
                  <div className="fw-semibold">
                    {addressLabel === 'home' ? 'Casa' : addressLabel === 'office' ? 'Oficina' : 'Dirección'}{': '}
                    {address || (addressLabel === 'home' ? homeAddr?.line1 : officeAddr?.line1) || '—'}
                  </div>
                  {(addressLabel && (addressLabel === 'home' ? homeAddr : officeAddr)) && (
                    <div className="small text-muted mt-1">
                      {addressLabel === 'home'
                        ? [
                            homeAddr?.city ? `Ciudad: ${homeAddr.city}` : null,
                            homeAddr?.country ? `País: ${homeAddr.country}` : null,
                            homeAddr?.zip ? `ZIP: ${homeAddr.zip}` : null,
                          ].filter(Boolean).join(' · ')
                        : [
                            officeAddr?.city ? `Ciudad: ${officeAddr.city}` : null,
                            officeAddr?.country ? `País: ${officeAddr.country}` : null,
                            officeAddr?.zip ? `ZIP: ${officeAddr.zip}` : null,
                          ].filter(Boolean).join(' · ')
                      }
                    </div>
                  )}
                  <div className="mt-2 small">
                    <span className="text-muted">Cliente:</span>{' '}
                    {customerName || '—'}
                    <span className="text-muted ms-2">Tel:</span>{' '}
                    {phone || '—'}
                  </div>
                </div>
              )}

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
