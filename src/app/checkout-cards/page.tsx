// src/app/checkout-cards/page.tsx
'use client';

import React, { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import { useNewCart } from '@/lib/newcart/context';
import type { DineInInfo, DeliveryInfo } from '@/lib/newcart/types';
import { useRouter } from 'next/navigation';
import '@/lib/firebase/client';

import {
  getFirestore,
  collection,
  addDoc,
  serverTimestamp,
  getDocs,
  query,
  where,
  orderBy,
} from 'firebase/firestore';
import { getAuth } from 'firebase/auth';

type PickupInfo = { type: 'pickup'; phone: string; notes?: string };
type DeliveryOption = { id: string; title: string; description?: string; price: number; isActive?: boolean; sortOrder?: number; };
type Addr = { line1?: string; city?: string; country?: string; zip?: string; notes?: string };
type PayMethod = 'cash' | 'paypal';

function fmtQ(n?: number) {
  const v = Number.isFinite(Number(n)) ? Number(n) : 0;
  try { return new Intl.NumberFormat('es-GT', { style: 'currency', currency: 'GTQ' }).format(v); }
  catch { return `Q ${v.toFixed(2)}`; }
}

/** Convierte undefined -> null (solo para `orderInfo`) */
function undefToNullDeep<T>(value: T): T {
  if (Array.isArray(value)) return value.map(undefToNullDeep) as any;
  if (value && typeof value === 'object') {
    const out: any = {};
    for (const [k, v] of Object.entries(value)) out[k] = v === undefined ? null : undefToNullDeep(v as any);
    return out;
  }
  return (value === undefined ? (null as any) : value) as T;
}

/** ------- Hook compartido con lógica de checkout (sin Stripe) ------- */
function useCheckoutState() {
  const cart = useNewCart();
  const subtotal = useMemo(() => cart.computeGrandTotal(), [cart, cart.items]);

  const [mode, setMode] = useState<'dine-in' | 'delivery' | 'pickup'>('dine-in');
  const [table, setTable] = useState('');
  const [notes, setNotes] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [customerName, setCustomerName] = useState<string>('');
  const [homeAddr, setHomeAddr] = useState<Addr | null>(null);
  const [officeAddr, setOfficeAddr] = useState<Addr | null>(null);
  const [addressLabel, setAddressLabel] = useState<'' | 'home' | 'office'>('');
  const [deliveryOptions, setDeliveryOptions] = useState<DeliveryOption[]>([]);
  const [selectedDeliveryOptionId, setSelectedDeliveryOptionId] = useState<string>('');
  const [tip, setTip] = useState<number>(0);
  const [tipEdited, setTipEdited] = useState<boolean>(false);
  const [saving, setSaving] = useState(false);
  const [payMethod, setPayMethod] = useState<PayMethod>('cash');

  const router = useRouter();
  const db = getFirestore();

  // Cargar datos del customer
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
      } catch {}
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

  // Cargar opciones de envío
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (mode !== 'delivery') {
        setDeliveryOptions([]);
        setSelectedDeliveryOptionId('');
        return;
      }
      try {
        const qRef = query(
          collection(db, 'deliveryOptions'),
          where('isActive', '==', true),
          orderBy('sortOrder', 'asc')
        );
        const snap = await getDocs(qRef);
        if (cancelled) return;
        const arr = snap.docs.map((d) => {
          const raw = d.data() as any;
          return {
            id: d.id,
            title: String(raw.title ?? ''),
            description: raw.description ? String(raw.description) : undefined,
            price: Number(raw.price ?? 0),
            isActive: Boolean(raw.isActive ?? true),
            sortOrder: Number.isFinite(raw.sortOrder) ? Number(raw.sortOrder) : undefined,
          } as DeliveryOption;
        });
        setDeliveryOptions(arr);
        if (!selectedDeliveryOptionId && arr.length > 0) {
          setSelectedDeliveryOptionId(arr[0].id);
        }
      } catch {
        try {
          const qRef = query(
            collection(db, 'deliveryOptions'),
            where('isActive', '==', true)
          );
          const snap = await getDocs(qRef);
          if (cancelled) return;
          const arr = snap.docs
            .map((d) => {
              const raw = d.data() as any;
              return {
                id: d.id,
                title: String(raw.title ?? ''),
                description: raw.description ? String(raw.description) : undefined,
                price: Number(raw.price ?? 0),
                isActive: Boolean(raw.isActive ?? true),
                sortOrder: Number.isFinite(raw.sortOrder) ? Number(raw.sortOrder) : undefined,
              } as DeliveryOption;
            })
            .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
          setDeliveryOptions(arr);
          if (!selectedDeliveryOptionId && arr.length > 0) {
            setSelectedDeliveryOptionId(arr[0].id);
          }
        } catch {
          setDeliveryOptions([]);
        }
      }
    };
    load();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // Tip 10% para dine-in/pickup
  useEffect(() => {
    if (mode === 'delivery') {
      if (!tipEdited) setTip(0);
      return;
    }
    if (!tipEdited) {
      const suggested = Math.round(subtotal * 0.1 * 100) / 100;
      setTip(suggested);
    }
  }, [mode, subtotal, tipEdited]);

  const deliveryFee = useMemo(() => {
    if (mode !== 'delivery') return 0;
    const opt = deliveryOptions.find((o) => o.id === selectedDeliveryOptionId);
    return Number(opt?.price || 0);
  }, [mode, deliveryOptions, selectedDeliveryOptionId]);

  const grandTotal = useMemo(() => {
    const t = (mode === 'delivery' ? 0 : tip) || 0;
    return subtotal + deliveryFee + t;
  }, [subtotal, deliveryFee, tip, mode]);

  const buildOrderPayload = useCallback(async () => {
    const meta: DineInInfo | DeliveryInfo | PickupInfo =
      mode === 'dine-in'
        ? { type: 'dine-in', table, notes: notes || undefined }
        : mode === 'delivery'
        ? { type: 'delivery', address, phone, notes: notes || undefined }
        : { type: 'pickup', phone, notes: notes || undefined };

    const auth = getAuth();
    const u = auth.currentUser;

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

      const selectedOpt = deliveryOptions.find((o) => o.id === selectedDeliveryOptionId);
      orderInfo = {
        ...(meta as DeliveryInfo),
        delivery: 'pending',
        customerName: customerName || u?.displayName || undefined,
        addressLabel: addressLabel || undefined,
        addressInfo,
        addressNotes: selectedAddr?.notes || undefined,
        deliveryOptionId: selectedOpt?.id || undefined,
        deliveryOption: selectedOpt
          ? { title: selectedOpt.title, description: selectedOpt.description || '', price: Number(selectedOpt.price || 0) }
          : undefined,
      };
    }
    const cleanOrderInfo = undefToNullDeep(orderInfo);

    return {
      items: cart.items.map((ln) => ({
        menuItemId: ln.menuItemId,
        menuItemName: ln.menuItemName,
        basePrice: ln.basePrice,
        quantity: ln.quantity,
        addons: ln.addons.map((a) => ({ name: a.name, price: a.price })),
        optionGroups: ln.optionGroups.map((g) => ({
          groupId: g.groupId,
          groupName: g.groupName,
          type: g.type || 'single',
          items: g.items.map((it) => ({ id: it.id, name: it.name, priceDelta: it.priceDelta })),
        })),
        lineTotal: cart.computeLineTotal(ln),
      })),
      orderTotal: grandTotal,
      orderInfo: cleanOrderInfo,
      totals: {
        subtotal,
        deliveryFee,
        tip: mode === 'delivery' ? 0 : tip,
        currency: process.env.NEXT_PUBLIC_PAY_CURRENCY || 'GTQ',
      },
      status: 'placed',
      createdAt: serverTimestamp(),
      ...(u ? {
        userEmail: u.email,
        userEmail_lower: u.email?.toLowerCase() || undefined,
        createdBy: { uid: u.uid, email: u.email ?? null }
      } : {}),
    };
  }, [
    address, addressLabel, customerName, deliveryFee, deliveryOptions,
    grandTotal, homeAddr, mode, notes, officeAddr, phone, selectedDeliveryOptionId,
    subtotal, table, tip, // cart.items se usa en map; depende de referencia estable de cart
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ]);

  return {
    state: {
      mode, table, notes, address, phone, customerName,
      homeAddr, officeAddr, addressLabel, deliveryOptions, selectedDeliveryOptionId,
      tip, tipEdited, saving, payMethod, hasDropdown, subtotal, deliveryFee, grandTotal
    },
    actions: {
      setMode, setTable, setNotes, setAddress, setPhone, setAddressLabel,
      setSelectedDeliveryOptionId, setTip, setTipEdited, setSaving, setPayMethod,
      onChangeAddressLabel,
    },
    helpers: { buildOrderPayload, cart, db, router },
  } as const;
}

/** ------- UI (efectivo + PayPal, sin Stripe) ------- */
function CheckoutUI(props: {
  state: ReturnType<typeof useCheckoutState>['state'],
  actions: ReturnType<typeof useCheckoutState>['actions'],
  onSubmitCash: () => Promise<void>,
  paypalActiveHint?: string,
}) {
  const { state, actions, onSubmitCash, paypalActiveHint } = props;
  const {
    mode, table, notes, address, phone, customerName,
    homeAddr, officeAddr, addressLabel, deliveryOptions, selectedDeliveryOptionId,
    tip, tipEdited, saving, payMethod, hasDropdown, subtotal, deliveryFee, grandTotal
  } = state;
  const {
    setMode, setTable, setNotes, setAddress, setPhone, setAddressLabel,
    setSelectedDeliveryOptionId, setTip, setTipEdited, setSaving, setPayMethod,
    onChangeAddressLabel,
  } = actions;

  const disableSubmit =
    saving ||
    (mode === 'dine-in' ? !table.trim() :
     mode === 'delivery' ? !(address && phone && selectedDeliveryOptionId) :
     !phone);

  return (
    <div className="container py-4">
      <h1 className="h4 mb-3">Checkout</h1>

      <div className="row g-4">
        <div className="col-12 col-lg-7">
          <div className="card border-0 shadow-sm">
            <div className="card-header"><div className="fw-semibold">Detalles</div></div>
            <div className="card-body">
              {/* Tipo de pedido */}
              <div className="mb-3">
                <label className="form-label fw-semibold">Tipo de pedido</label>
                <div className="d-flex gap-2">
                  <button className={`btn ${mode === 'dine-in' ? 'btn-primary' : 'btn-outline-primary'}`} onClick={() => { setMode('dine-in'); setTipEdited(false); }} disabled={saving}>Dine-in</button>
                  <button className={`btn ${mode === 'delivery' ? 'btn-primary' : 'btn-outline-primary'}`} onClick={() => { setMode('delivery'); setTipEdited(false); }} disabled={saving}>Delivery</button>
                  <button className={`btn ${mode === 'pickup' ? 'btn-primary' : 'btn-outline-primary'}`} onClick={() => { setMode('pickup'); setTipEdited(false); }} disabled={saving}>Pickup</button>
                </div>
              </div>

              {mode === 'dine-in' && (
                <>
                  <div className="mb-3">
                    <label className="form-label">Mesa</label>
                    <input className="form-control" value={table} onChange={(e) => setTable(e.target.value)} placeholder="Ej. Mesa 5" disabled={saving} />
                  </div>
                  <div className="mb-3">
                    <label className="form-label">Notas (opcional)</label>
                    <textarea className="form-control" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Instrucciones adicionales" disabled={saving} />
                  </div>
                </>
              )}

              {mode === 'delivery' && (
                <>
                  <div className="mb-3">
                    <label className="form-label">Dirección</label>
                    {hasDropdown ? (
                      <>
                        <select className="form-select" value={addressLabel || ''} onChange={(e) => onChangeAddressLabel(e.target.value as 'home' | 'office')} disabled={saving}>
                          {homeAddr?.line1 && String(homeAddr.line1).trim() !== '' && (<option value="home">Casa — {homeAddr.line1}</option>)}
                          {officeAddr?.line1 && String(officeAddr.line1).trim() !== '' && (<option value="office">Oficina — {officeAddr.line1}</option>)}
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
                      <input className="form-control" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Ej. 5a avenida 10-11..." disabled={saving} />
                    )}
                  </div>

                  <div className="mb-3">
                    <label className="form-label">Teléfono</label>
                    <input className="form-control" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Ej. 5555-5555" disabled={saving} />
                  </div>

                  <div className="mb-3">
                    <label className="form-label">Opciones de envío</label>
                    {deliveryOptions.length === 0 ? (
                      <div className="form-text">No hay opciones de envío disponibles.</div>
                    ) : (
                      <div className="d-flex flex-column gap-2">
                        {deliveryOptions.map((opt) => (
                          <label key={opt.id} className="border rounded p-2 d-flex align-items-start gap-2">
                            <input type="radio" name="delivery-opt" className="form-check-input mt-1" checked={selectedDeliveryOptionId === opt.id} onChange={() => setSelectedDeliveryOptionId(opt.id)} disabled={saving} />
                            <div className="w-100">
                              <div className="d-flex justify-content-between">
                                <div className="fw-semibold">{opt.title}</div>
                                <div className="fw-semibold">{fmtQ(opt.price)}</div>
                              </div>
                              {opt.description && <div className="text-muted small">{opt.description}</div>}
                            </div>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="mb-3">
                    <label className="form-label">Notas (opcional)</label>
                    <textarea className="form-control" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Instrucciones adicionales" disabled={saving} />
                  </div>
                </>
              )}

              {mode === 'pickup' && (
                <>
                  <div className="mb-3">
                    <label className="form-label">Teléfono</label>
                    <input className="form-control" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Ej. 5555-5555" disabled={saving} />
                  </div>
                  <div className="mb-3">
                    <label className="form-label">Notas (opcional)</label>
                    <textarea className="form-control" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Instrucciones adicionales" disabled={saving} />
                  </div>
                </>
              )}

              {/* MÉTODO DE PAGO */}
              <div className="mb-3">
                <label className="form-label fw-semibold">Método de pago</label>
                <div className="d-flex flex-column gap-2">
                  <label className="d-flex align-items-center gap-2">
                    <input type="radio" name="pm" className="form-check-input" checked={payMethod==='cash'} onChange={() => setPayMethod('cash')} />
                    <span>Efectivo</span>
                  </label>

                  <label className="d-flex align-items-center gap-2">
                    <input type="radio" name="pm" className="form-check-input" checked={payMethod==='paypal'} onChange={() => setPayMethod('paypal')} />
                    <span>PayPal</span>
                    {paypalActiveHint && <span className="small text-muted ms-2">{paypalActiveHint}</span>}
                  </label>
                </div>
              </div>

              {/* PayPal Buttons */}
              {payMethod === 'paypal' && (
                <div className="mb-3">
                  <div id="paypal-buttons-container" />
                </div>
              )}
            </div>

            <div className="card-footer">
              <div className="d-flex justify-content-between align-items-center">
                <div className="text-muted small">Se cobrará según el método seleccionado.</div>
                <button
                  className="btn btn-primary"
                  disabled={disableSubmit}
                  onClick={() => {
                    if (payMethod === 'cash') return onSubmitCash();
                    if (payMethod === 'paypal') {
                      alert('Usa el botón PayPal para continuar.');
                    }
                  }}
                >
                  {saving ? 'Procesando…' : (payMethod === 'cash' ? 'Confirmar pedido' : 'Pagar ahora')}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Resumen */}
        <div className="col-12 col-lg-5">
          <div className="card border-0 shadow-sm">
            <div className="card-header"><div className="fw-semibold">Resumen</div></div>
            <div className="card-body">
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
                        ? [homeAddr?.city && `Ciudad: ${homeAddr.city}`, homeAddr?.country && `País: ${homeAddr.country}`, homeAddr?.zip && `ZIP: ${homeAddr.zip}`].filter(Boolean).join(' · ')
                        : [officeAddr?.city && `Ciudad: ${officeAddr.city}`, officeAddr?.country && `País: ${officeAddr.country}`, officeAddr?.zip && `ZIP: ${officeAddr.zip}`].filter(Boolean).join(' · ')
                      }
                    </div>
                  )}
                  <div className="mt-2 small">
                    <span className="text-muted">Cliente:</span> {customerName || '—'}
                    <span className="text-muted ms-2">Tel:</span> {phone || '—'}
                  </div>
                </div>
              )}

              {/* Totales */}
              <div className="mt-3">
                <div className="d-flex justify-content-between"><div>Subtotal</div><div className="fw-semibold">{fmtQ(subtotal)}</div></div>
                {mode === 'delivery' && (<div className="d-flex justify-content-between"><div>Envío</div><div className="fw-semibold">{fmtQ(deliveryFee)}</div></div>)}
                {mode !== 'delivery' && (
                  <div className="d-flex align-items-center justify-content-between gap-2 mt-2">
                    <label className="mb-0">Propina (sugerido 10%)</label>
                    <div className="d-flex align-items-center gap-2">
                      <input type="number" min="0" step="0.01" className="form-control form-control-sm" style={{ width: 120 }}
                        value={Number.isFinite(tip) ? tip : 0}
                        onChange={(e) => { setTipEdited(true); const v = Number(e.target.value); setTip(Number.isFinite(v) ? v : 0); }} />
                      <span className="text-muted small">{fmtQ(tip)}</span>
                    </div>
                  </div>
                )}
                <hr />
                <div className="d-flex justify-content-between"><div className="fw-semibold">Gran total</div><div className="fw-bold">{fmtQ(grandTotal)}</div></div>
              </div>
            </div>
            <div className="card-footer d-flex justify-content-between">
              <div className="small text-muted">Total según método seleccionado.</div>
              <div />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** ------- Variante (efectivo + PayPal) ------- */
function CheckoutCoreNoStripe() {
  const { state, actions, helpers } = useCheckoutState();
  const { cart, db, router, buildOrderPayload } = helpers;

  // Efectivo
  const onSubmitCash = async () => {
    const payload = await buildOrderPayload();
    (payload as any).payment = {
      provider: 'cash',
      status: 'pending',
      amount: payload.orderTotal,
      currency: (payload as any).totals?.currency || 'GTQ',
      createdAt: serverTimestamp(),
    };
    try {
      actions.setSaving(true);
      const ref = await addDoc(collection(db, 'orders'), payload);
      cart.clear();
      router.push('/cart-new');
      alert('¡Orden creada (efectivo)! ID: ' + ref.id);
    } catch (e) {
      console.error(e);
      alert('No se pudo crear la orden.');
    } finally {
      actions.setSaving(false);
    }
  };

  // PayPal: carga SDK si hay client id
  const [paypalReady, setPaypalReady] = useState(false);
  const paypalButtonsRef = useRef<any>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const cid = process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID;
    if (!cid) return;
    if ((window as any).paypal) { setPaypalReady(true); return; }
    const s = document.createElement('script');
    const currency = process.env.NEXT_PUBLIC_PAY_CURRENCY || 'GTQ';
    s.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(cid)}&currency=${encodeURIComponent(currency)}`;
    s.async = true;
    s.onload = () => setPaypalReady(true);
    s.onerror = () => console.warn('No se pudo cargar PayPal SDK.');
    document.body.appendChild(s);
  }, []);

  useEffect(() => {
    if (helpers == null) return;
    if (state.payMethod !== 'paypal') return;
    if (!paypalReady) return;
    const paypal = (window as any).paypal;
    if (!paypal?.Buttons) return;

    let destroyed = false;
    const renderButtons = async () => {
      const el = document.getElementById('paypal-buttons-container');
      if (!el) return;

      // Cierra instancia previa antes de re-render
      if (paypalButtonsRef.current?.close) {
        try { await paypalButtonsRef.current.close(); } catch {}
        paypalButtonsRef.current = null;
      }

      const btns = paypal.Buttons({
        createOrder: async () => {
          const draft = await helpers.buildOrderPayload();
          const res = await fetch('/api/pay/paypal/create-order', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ orderDraft: draft }),
          });
          if (!res.ok) {
            const j = await res.json().catch(() => null);
            throw new Error(j?.error || 'No se pudo crear orden PayPal.');
          }
          const { paypalOrderId } = await res.json();
          return paypalOrderId;
        },
        onApprove: async (data: any) => {
          try {
            const res = await fetch('/api/pay/paypal/capture', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ paypalOrderId: data.orderID }),
            });
            if (!res.ok) {
              const j = await res.json().catch(() => null);
              throw new Error(j?.error || 'No se pudo capturar PayPal.');
            }

            // Cierra el botón ANTES de navegar
            if (paypalButtonsRef.current?.close) {
              try { await paypalButtonsRef.current.close(); } catch {}
              paypalButtonsRef.current = null;
            }

            helpers.cart.clear();
            helpers.router.push('/cart-new');
            alert('Pago PayPal capturado. La orden se confirmará en breve.');
          } catch (e: any) {
            alert(e?.message || 'Error capturando PayPal.');
          }
        },
        onError: (err: any) => {
          console.error('PayPal error:', err);
          alert('Error en PayPal.');
        },
        style: { layout: 'vertical', shape: 'rect', label: 'paypal' },
      });

      if (!destroyed) {
        paypalButtonsRef.current = btns;
        await btns.render('#paypal-buttons-container');
      }
    };

    renderButtons();
    return () => {
      destroyed = true;
      if (paypalButtonsRef.current?.close) {
        try { paypalButtonsRef.current.close(); } catch {}
        paypalButtonsRef.current = null;
      }
    };
  }, [state.payMethod, paypalReady, helpers]);

  return (
    <CheckoutUI
      state={state}
      actions={actions}
      onSubmitCash={onSubmitCash}
      paypalActiveHint={!process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID ? '(Configura NEXT_PUBLIC_PAYPAL_CLIENT_ID)' : undefined}
    />
  );
}

/** ------- Export por defecto (solo efectivo + PayPal) ------- */
export default function CheckoutCardsPage() {
  return <CheckoutCoreNoStripe />;
}
