// src/app/(client)/checkout-new/page.tsx
'use client';

import React, { useMemo, useState, useEffect } from 'react';
import { useNewCart } from '@/lib/newcart/context';
import type { DineInInfo, DeliveryInfo } from '@/lib/newcart/types';
import { useRouter } from 'next/navigation';
import '@/lib/firebase/client'; // Asegúrate que importe tu inicializador

// Firestore
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
// Leer usuario actual para tomar su email (si hay sesión)
import { getAuth } from 'firebase/auth';

function fmtQ(n?: number) {
  const v = Number.isFinite(Number(n)) ? Number(n) : 0;
  try { return new Intl.NumberFormat('es-GT', { style: 'currency', currency: 'GTQ' }).format(v); }
  catch { return `Q ${v.toFixed(2)}`; }
}

/** 🔧 Convierte cualquier `undefined` a `null` (profundidad completa). */
function undefToNullDeep<T>(value: T): T {
  if (Array.isArray(value)) return value.map(undefToNullDeep) as any;
  if (value && typeof value === 'object') {
    const out: any = {};
    for (const [k, v] of Object.entries(value)) out[k] = v === undefined ? null : undefToNullDeep(v as any);
    return out;
  }
  return (value === undefined ? (null as any) : value) as T;
}

/** Nuevo tipo local para pickup (no rompe tu types.ts) */
type PickupInfo = {
  type: 'pickup';
  phone: string;
  notes?: string;
};

/** Estructura de opción de envío (colección: deliveryOptions) */
type DeliveryOption = {
  id: string;
  title: string;
  description?: string;
  price: number;        // GTQ
  isActive?: boolean;
  sortOrder?: number;
};

type Addr = {
  line1?: string;
  city?: string;
  country?: string;
  zip?: string;
  notes?: string;
};

export default function CheckoutNewPage() {
  const cart = useNewCart();

  // Subtotal = lo que hoy era tu "grand" (suma de productos + addons + groups)
  const subtotal = useMemo(() => cart.computeGrandTotal(), [cart, cart.items]);

  // Modo de pedido (agregamos 'pickup')
  const [mode, setMode] = useState<'dine-in' | 'delivery' | 'pickup'>('dine-in');

  // dine-in
  const [table, setTable] = useState('');
  const [notes, setNotes] = useState('');

  // delivery / pickup (teléfono)
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');

  // Datos del usuario (para dropdown y payload extra)
  const [customerName, setCustomerName] = useState<string>('');
  const [homeAddr, setHomeAddr] = useState<Addr | null>(null);
  const [officeAddr, setOfficeAddr] = useState<Addr | null>(null);
  const [addressLabel, setAddressLabel] = useState<'' | 'home' | 'office'>('');

  // Opciones de envío (solo delivery)
  const [deliveryOptions, setDeliveryOptions] = useState<DeliveryOption[]>([]);
  const [selectedDeliveryOptionId, setSelectedDeliveryOptionId] = useState<string>('');

  // Propina (solo dine-in y pickup)
  const [tip, setTip] = useState<number>(0);
  const [tipEdited, setTipEdited] = useState<boolean>(false);

  const [saving, setSaving] = useState(false);

  const router = useRouter();
  const db = getFirestore();

  // Cargar datos del cliente para prellenar teléfono y direcciones (igual que el viejo)
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

  // Cargar opciones de envío cuando el modo sea delivery
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (mode !== 'delivery') {
        setDeliveryOptions([]);
        setSelectedDeliveryOptionId('');
        return;
      }
      try {
        // Intento principal: where + orderBy (requiere índice compuesto)
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
      } catch (e) {
        // Fallback sin índice: solo where y ordenamos en memoria
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
          console.warn('[deliveryOptions] usando fallback sin índice compuesto. Crea el índice para habilitar orderBy en server.');
        } catch (inner) {
          console.error('Error leyendo deliveryOptions:', inner);
          setDeliveryOptions([]);
        }
      }
    };
    load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // Si NO es delivery, sugerimos propina = 10% del subtotal (editable)
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

  async function onSubmit() {
    // Meta por tipo
    const meta: DineInInfo | DeliveryInfo | PickupInfo =
      mode === 'dine-in'
        ? { type: 'dine-in', table, notes: notes || undefined }
        : mode === 'delivery'
        ? { type: 'delivery', address, phone, notes: notes || undefined }
        : { type: 'pickup', phone, notes: notes || undefined };

    // Tomar email/uid del usuario si está autenticado
    const auth = getAuth();
    const u = auth.currentUser;
    const userEmail = u?.email || undefined;
    const uid = u?.uid || undefined;

    // Extra de orderInfo SOLO para delivery (exactamente como el viejo + envío)
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
        delivery: 'pending', // igual que antes
        customerName: customerName || u?.displayName || undefined,
        addressLabel: addressLabel || undefined,
        addressInfo,                               // snapshot completo (como antes)
        addressNotes: selectedAddr?.notes || undefined,

        // NUEVO: opción de envío congelada en la orden
        deliveryOptionId: selectedOpt?.id || undefined,
        deliveryOption: selectedOpt
          ? {
              title: selectedOpt.title,
              description: selectedOpt.description || '',
              price: Number(selectedOpt.price || 0),
            }
          : undefined,
      };
    }

    // ✅ aplicar helper SOLO a orderInfo para evitar "undefined"
    const cleanOrderInfo = undefToNullDeep(orderInfo);

    const orderPayload = {
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

      // 🔁 orderTotal ahora es el GRAN TOTAL (subtotal + envío + propina)
      orderTotal: grandTotal,

      // Estructura original (respetada) + nuevos campos solo cuando aplica
      orderInfo: cleanOrderInfo,

      // NUEVO: desglose (no rompe pantallas viejas)
      totals: {
        subtotal,
        deliveryFee,
        tip: mode === 'delivery' ? 0 : tip,
        currency: 'GTQ',
      },

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

  const disableSubmit =
    saving ||
    cart.items.length === 0 ||
    (mode === 'dine-in' ? !table.trim() :
     mode === 'delivery' ? !(address && phone && selectedDeliveryOptionId) :
     !phone);

  return (
    <div className="container py-4">
      <h1 className="h4 mb-3">Checkout (nuevo)</h1>

      <div className="row g-4">
        <div className="col-12 col-lg-7">
          <div className="card border-0 shadow-sm">
            <div className="card-header">
              <div className="fw-semibold">Detalles</div>
            </div>
            <div className="card-body">
              {/* Tipo de pedido */}
              <div className="mb-3">
                <label className="form-label fw-semibold">Tipo de pedido</label>
                <div className="d-flex gap-2">
                  <button
                    className={`btn ${mode === 'dine-in' ? 'btn-primary' : 'btn-outline-primary'}`}
                    onClick={() => { setMode('dine-in'); setTipEdited(false); }}
                    disabled={saving}
                  >
                    Dine-in
                  </button>
                  <button
                    className={`btn ${mode === 'delivery' ? 'btn-primary' : 'btn-outline-primary'}`}
                    onClick={() => { setMode('delivery'); setTipEdited(false); }}
                    disabled={saving}
                  >
                    Delivery
                  </button>
                  <button
                    className={`btn ${mode === 'pickup' ? 'btn-primary' : 'btn-outline-primary'}`}
                    onClick={() => { setMode('pickup'); setTipEdited(false); }}
                    disabled={saving}
                  >
                    Pickup
                  </button>
                </div>
              </div>

              {mode === 'dine-in' && (
                <>
                  <div className="mb-3">
                    <label className="form-label">Mesa</label>
                    <input
                      className="form-control"
                      value={table}
                      onChange={(e) => setTable(e.target.value)}
                      placeholder="Ej. Mesa 5"
                      disabled={saving}
                    />
                  </div>
                  <div className="mb-3">
                    <label className="form-label">Notas (opcional)</label>
                    <textarea
                      className="form-control"
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="Instrucciones adicionales"
                      disabled={saving}
                    />
                  </div>
                </>
              )}

              {mode === 'delivery' && (
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
                        onChange={(e) => setAddress(e.target.value)}
                        placeholder="Ej. 5a avenida 10-11..."
                        disabled={saving}
                      />
                    )}
                  </div>

                  <div className="mb-3">
                    <label className="form-label">Teléfono</label>
                    <input
                      className="form-control"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="Ej. 5555-5555"
                      disabled={saving}
                    />
                  </div>

                  {/* Opciones de envío */}
                  <div className="mb-3">
                    <label className="form-label">Opciones de envío</label>
                    {deliveryOptions.length === 0 ? (
                      <div className="form-text">No hay opciones de envío disponibles.</div>
                    ) : (
                      <div className="d-flex flex-column gap-2">
                        {deliveryOptions.map((opt) => (
                          <label key={opt.id} className="border rounded p-2 d-flex align-items-start gap-2">
                            <input
                              type="radio"
                              name="delivery-opt"
                              className="form-check-input mt-1"
                              checked={selectedDeliveryOptionId === opt.id}
                              onChange={() => setSelectedDeliveryOptionId(opt.id)}
                              disabled={saving}
                            />
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
                    <textarea
                      className="form-control"
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="Instrucciones adicionales"
                      disabled={saving}
                    />
                  </div>
                </>
              )}

              {mode === 'pickup' && (
                <>
                  <div className="mb-3">
                    <label className="form-label">Teléfono</label>
                    <input
                      className="form-control"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="Ej. 5555-5555"
                      disabled={saving}
                    />
                  </div>
                  <div className="mb-3">
                    <label className="form-label">Notas (opcional)</label>
                    <textarea
                      className="form-control"
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="Instrucciones adicionales"
                      disabled={saving}
                    />
                  </div>
                </>
              )}
            </div>

            <div className="card-footer">
              <button className="btn btn-primary" disabled={disableSubmit} onClick={onSubmit}>
                {saving ? 'Guardando…' : 'Confirmar pedido'}
              </button>
            </div>
          </div>
        </div>

        {/* Resumen */}
        <div className="col-12 col-lg-5">
          <div className="card border-0 shadow-sm">
            <div className="card-header">
              <div className="fw-semibold">Resumen</div>
            </div>
            <div className="card-body">
              {/* Bloque de resumen de entrega con alias y contacto (idéntico al viejo comportamiento) */}
              {mode === 'delivery' && (
                <div className="border rounded p-2 mb-3 bg-light">
                  <div className="small text-muted">Entrega</div>
                  <div className="fw-semibold">
                    {addressLabel === 'home' ? 'Casa' : addressLabel === 'office' ? 'Oficina' : 'Dirección'}
                    {': '}
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
                    <span className="text-muted">Cliente:</span> {customerName || '—'}
                    <span className="text-muted ms-2">Tel:</span> {phone || '—'}
                  </div>
                </div>
              )}

              {/* Líneas del carrito */}
              <div className="d-flex flex-column gap-3">
                {cart.items.map((ln, idx) => {
                  const unitExtras = cart.computeLineTotal({ ...ln, quantity: 1 }) - ln.basePrice;
                  const lineSum = cart.computeLineTotal(ln);
                  return (
                    <div key={`${ln.menuItemId}-${idx}`} className="border rounded p-2">
                      <div className="d-flex justify-content-between">
                        <div className="fw-semibold">
                          {ln.menuItemName} <span className="text-muted">× {ln.quantity}</span>
                        </div>
                        <div className="fw-semibold">{fmtQ(lineSum)}</div>
                      </div>
                      {(ln.addons.length > 0 || ln.optionGroups.some((g) => g.items.length > 0)) && (
                        <div className="mt-2">
                          {ln.addons.map((ad, i) => (
                            <div className="d-flex justify-content-between small" key={`ad-${idx}-${i}`}>
                              <div>— (addons) {ad.name}</div>
                              <div>{fmtQ(ad.price)}</div>
                            </div>
                          ))}
                          {ln.optionGroups.map((g) =>
                            g.items.map((it) => (
                              <div
                                className="d-flex justify-content-between small"
                                key={`gi-${idx}-${g.groupId}-${it.id}`}
                              >
                                <div>— (groupitems) {it.name}</div>
                                <div>{fmtQ(it.priceDelta)}</div>
                              </div>
                            ))
                          )}
                        </div>
                      )}
                      <div className="text-muted small mt-1">
                        ({fmtQ(ln.basePrice + unitExtras)} c/u)
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Desglose de totales */}
              <div className="mt-3">
                <div className="d-flex justify-content-between">
                  <div>Subtotal</div>
                  <div className="fw-semibold">{fmtQ(subtotal)}</div>
                </div>

                {mode === 'delivery' && (
                  <div className="d-flex justify-content-between">
                    <div>Envío</div>
                    <div className="fw-semibold">{fmtQ(deliveryFee)}</div>
                  </div>
                )}

                {mode !== 'delivery' && (
                  <div className="d-flex align-items-center justify-content-between gap-2 mt-2">
                    <label className="mb-0">Propina (sugerido 10%)</label>
                    <div className="d-flex align-items-center gap-2">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        className="form-control form-control-sm"
                        style={{ width: 120 }}
                        value={Number.isFinite(tip) ? tip : 0}
                        onChange={(e) => {
                          setTipEdited(true);
                          const v = Number(e.target.value);
                          setTip(Number.isFinite(v) ? v : 0);
                        }}
                      />
                      <span className="text-muted small">{fmtQ(tip)}</span>
                    </div>
                  </div>
                )}

                <hr />

                <div className="d-flex justify-content-between">
                  <div className="fw-semibold">Gran total</div>
                  <div className="fw-bold">{fmtQ(grandTotal)}</div>
                </div>
              </div>
            </div>

            <div className="card-footer d-flex justify-content-between">
              <div>Se cobrará en caja o pasarela seleccionada más adelante.</div>
              <div className="fw-semibold">{/* redundante, ya mostramos arriba */}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
