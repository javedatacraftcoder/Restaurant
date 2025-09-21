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

// ✅ NUEVO: motor de impuestos
import { getActiveTaxProfile } from '@/lib/tax/profile';
import { calculateTaxSnapshot } from '@/lib/tax/engine';

type PickupInfo = { type: 'pickup'; phone: string; notes?: string };
type DeliveryOption = { id: string; title: string; description?: string; price: number; isActive?: boolean; sortOrder?: number; };
type Addr = { line1?: string; city?: string; country?: string; zip?: string; notes?: string };
type PayMethod = 'cash' | 'paypal';

// --- NUEVO: tipos de promo en el cliente ---
type AppliedPromo = {
  promoId: string;
  code: string;
  discountTotalCents: number;
  discountByLine: Array<{ lineId: string; menuItemId: string; discountCents: number; eligible: boolean; lineSubtotalCents: number; }>;
};

function fmtQ(n?: number) {
  const v = Number.isFinite(Number(n)) ? Number(n) : 0;
  try { return new Intl.NumberFormat('es-GT', { style: 'currency', currency: 'USD' }).format(v); }
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

  // --- NUEVO: estado para promociones ---
  const [promoCode, setPromoCode] = useState('');
  const [promoApplying, setPromoApplying] = useState(false);
  const [promoError, setPromoError] = useState<string | null>(null);
  const [promo, setPromo] = useState<AppliedPromo | null>(null);
  const promoDiscountGTQ = useMemo(() => (promo?.discountTotalCents ?? 0) / 100, [promo]);

  // ✅ NUEVO: datos de facturación (para snapshot fiscal)
  const [customerTaxId, setCustomerTaxId] = useState<string>('');
  const [customerBillingName, setCustomerBillingName] = useState<string>('');

  // ✅ NUEVO: perfil y snapshot para UI
  const [activeProfile, setActiveProfile] = useState<any | null>(null);
  const [taxUI, setTaxUI] = useState<{
    pricesIncludeTax: boolean;
    currency: string;
    subTotalQ: number;
    taxQ: number;
    itemsGrandQ: number;
    grandPayableQ: number; // itemsGrand + deliveryOutside + tip - discount
  } | null>(null);

  const router = useRouter();
  const db = getFirestore();

  // Cargar datos del customer (direcciones y teléfono) — COPIADO DEL CHECKOUT VIEJO (+ billing.*)
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

        // ✅ NUEVO: billing.taxId / billing.name
        const taxId = c?.taxID ? String(c.taxID) : (c?.billing?.taxId ? String(c.billing.taxId) : '');
        if (taxId) setCustomerTaxId(taxId);
        const bName = c?.billing?.name ? String(c.billing.name) : '';
        if (bName) setCustomerBillingName(bName);

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

  // Cargar opciones de envío (idéntico al viejo)
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

  // --- NUEVO: cargar perfil ACTIVO (una vez) para la UI
  useEffect(() => {
    (async () => {
      const p = await getActiveTaxProfile();
      setActiveProfile(p || null);
    })();
  }, []);

  // --- NUEVO: calcular snapshot para la UI y total pagable con impuestos
  useEffect(() => {
    const toCents = (n: number | undefined | null) => Math.round(((n as number) || 0) * 100);

    const zeroProfile: any = {
      id: 'no-tax',
      country: 'GT',
      currency: process.env.NEXT_PUBLIC_PAY_CURRENCY || 'USD',
      pricesIncludeTax: true,
      rounding: 'half_up',
      rates: [{ code: 'ALL', label: 'No tax', rateBps: 0, appliesTo: 'all' }],
      surcharges: [],
      delivery: { mode: 'as_line', taxable: false },
    };

    const profile = activeProfile || zeroProfile;

    // mapear líneas del carrito → motor (mismo criterio que buildOrderPayload)
    const linesForTax = cart.items.map((ln: any) => {
      const perUnitTotal = cart.computeLineTotal({ ...ln, quantity: 1 });
      const perUnitExtras = perUnitTotal - ln.basePrice;
      return {
        lineId: ln.menuItemId + '-' + (Math.random().toString(36).slice(2)),
        quantity: ln.quantity,
        unitPriceCents: toCents(ln.basePrice),
        addonsCents: 0,
        optionsDeltaCents: toCents(perUnitExtras),
        lineTotalCents: undefined,
        taxExempt: false,
        name: ln.menuItemName,
      };
    });

    // dirección para jurisdicción
    let addressInfo: any = undefined;
    if (mode === 'delivery') {
      const selectedAddr = addressLabel === 'home' ? homeAddr
                        : addressLabel === 'office' ? officeAddr
                        : null;
      addressInfo = selectedAddr ? {
        line1: selectedAddr.line1 || '',
        city: selectedAddr.city || '',
        country: selectedAddr.country || '',
        zip: selectedAddr.zip || '',
        notes: selectedAddr.notes || '',
      } : {
        line1: address || '',
        city: homeAddr?.city || officeAddr?.city || '',
        country: homeAddr?.country || officeAddr?.country || '',
        zip: homeAddr?.zip || officeAddr?.zip || '',
      };
    }

    const draftInput = {
      currency: profile?.currency ?? 'USD',
      orderType: mode, // 'dine-in' | 'delivery' | 'pickup'
      lines: linesForTax,
      customer: {
        taxId: customerTaxId || undefined,
        name: customerBillingName || customerName || undefined,
      },
      deliveryFeeCents:
        (profile?.delivery?.mode === 'as_line' && mode === 'delivery')
          ? toCents(deliveryFee)
          : 0,
      deliveryAddressInfo: mode === 'delivery' ? (addressInfo || null) : null,
    };

    const snap = calculateTaxSnapshot(draftInput as any, profile as any);
    const subQ = (snap?.totals?.subTotalCents || 0) / 100;
    const taxQ = (snap?.totals?.taxCents || 0) / 100;
    const itemsGrandQ = (snap?.totals?.grandTotalCents || 0) / 100;

    const tipQ = mode === 'delivery' ? 0 : tip;
    const discountQ = promoDiscountGTQ;

    // si delivery va fuera del engine (out_of_scope), lo sumamos aparte
    const deliveryOutsideQ =
      (profile?.delivery?.mode === 'as_line') ? 0 : deliveryFee;

    const grandPayableQ = itemsGrandQ + deliveryOutsideQ + tipQ - discountQ;

    setTaxUI({
      pricesIncludeTax: !!profile?.pricesIncludeTax,
      currency: snap?.currency || profile?.currency || 'USD',
      subTotalQ: subQ,
      taxQ,
      itemsGrandQ,
      grandPayableQ,
    });
  }, [
    activeProfile, cart.items, mode, deliveryFee, tip, promoDiscountGTQ,
    addressLabel, address, homeAddr, officeAddr, customerTaxId, customerBillingName, customerName,
    cart
  ]);

  const hasDropdown =
    (homeAddr && homeAddr.line1 && String(homeAddr.line1).trim() !== '') ||
    (officeAddr && officeAddr.line1 && String(officeAddr.line1).trim() !== '');

  function onChangeAddressLabel(value: 'home' | 'office') {
    setAddressLabel(value);
    const src = value === 'home' ? homeAddr : officeAddr;
    setAddress(src?.line1 ? String(src.line1) : '');
  }

  // --- NUEVO: aplicar descuento de promoción al gran total (visual legacy)
  const grandTotal = useMemo(() => {
    const t = (mode === 'delivery' ? 0 : tip) || 0;
    return subtotal + deliveryFee + t - promoDiscountGTQ;
  }, [subtotal, deliveryFee, tip, mode, promoDiscountGTQ]);

  // --- NUEVO: aplicar/quitar código ---
  const applyPromo = useCallback(async () => {
    setPromoError(null);
    const code = (promoCode || '').trim().toUpperCase();
    if (!code) { setPromoError('Enter the coupon.'); return; }
    setPromoApplying(true);
    try {
      const auth = getAuth();
      const u = auth.currentUser;

      const lines = cart.items.map((ln: any, idx: number) => ({
        lineId: String(idx),
        menuItemId: ln.menuItemId,
        totalPriceCents: Math.round(cart.computeLineTotal(ln) * 100),
      }));

      const res = await fetch('/api/cart/apply-promo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code,
          orderType: mode,         // 'dine-in' | 'delivery' | 'pickup'
          userUid: u?.uid || null,
          lines,
        }),
      });
      const j = await res.json();
      if (!res.ok || !j?.ok) {
        setPromo(null);
        setPromoError(j?.reason || 'Invalid coupon.');
        return;
      }
      setPromo({
        promoId: j.promoId,
        code: j.code,
        discountTotalCents: j.discountTotalCents,
        discountByLine: j.discountByLine || [],
      });
      setPromoError(null);
    } catch (e: any) {
      setPromo(null);
      setPromoError('The coupon could not be validated.');
    } finally {
      setPromoApplying(false);
    }
  }, [promoCode, cart.items, mode, cart]);

  const clearPromo = useCallback(() => {
    setPromo(null);
    setPromoCode('');
    setPromoError(null);
  }, []);

  const buildOrderPayload = useCallback(async () => {
    const meta: DineInInfo | DeliveryInfo | PickupInfo =
      mode === 'dine-in'
        ? { type: 'dine-in', table, notes: notes || undefined }
        : mode === 'delivery'
        ? { type: 'delivery', address, phone, notes: notes || undefined }
        : { type: 'pickup', phone, notes: notes || undefined };

    const auth = getAuth();
    const u = auth.currentUser;

    // 👇 Bloque de dirección COPIADO del viejo (snapshot + label + notes)
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

    // --- NUEVO: snapshot de promociones aplicadas ---
    const appliedPromotions = promo ? [{
      promoId: promo.promoId,
      code: promo.code,
      discountTotalCents: promo.discountTotalCents,
      discountTotal: (promo.discountTotalCents / 100),
      byLine: promo.discountByLine,
    }] : [];

    // =========================
    // ✅ NUEVO: TAX SNAPSHOT (Fase B/C)
    // =========================
    const toCents = (n: number | undefined | null) => Math.round(((n as number) || 0) * 100);

    const active = await getActiveTaxProfile();
    const zeroProfile = {
      id: 'no-tax',
      country: 'GT',
      currency: process.env.NEXT_PUBLIC_PAY_CURRENCY || 'USD',
      pricesIncludeTax: true,
      rounding: 'half_up',
      rates: [
        { code: 'ALL', label: 'No tax', rateBps: 0, appliesTo: 'all' }
      ],
      surcharges: [],
      delivery: { mode: 'as_line', taxable: false },
    } as const;

    const profile = active || (zeroProfile as any);

    // mapear líneas del carrito → motor
    const linesForTax = cart.items.map((ln: any) => {
      const perUnitTotal = cart.computeLineTotal({ ...ln, quantity: 1 });
      const perUnitExtras = perUnitTotal - ln.basePrice;
      return {
        lineId: ln.menuItemId + '-' + (Math.random().toString(36).slice(2)),
        quantity: ln.quantity,
        unitPriceCents: toCents(ln.basePrice),
        addonsCents: 0,
        optionsDeltaCents: toCents(perUnitExtras),
        lineTotalCents: undefined,
        taxExempt: false,
        name: ln.menuItemName,
      };
    });

    // ✅ orderType con GUION (el engine ya lo entiende en Fase B)
    const orderTypeForTax = mode; // 'dine-in' | 'delivery' | 'pickup'

    // ✅ delivery como línea gravable opcional (según perfil)
    const rawDeliveryFeeCents = toCents(mode === 'delivery' ? deliveryFee : 0);

    const draftInput = {
      currency: profile?.currency ?? 'USD',
      orderType: orderTypeForTax,
      lines: linesForTax,
      customer: {
        taxId: customerTaxId || undefined,
        name: customerBillingName || customerName || undefined,
      },
      // Phase B: si el perfil dice "as_line", el engine suma el envío como línea
      deliveryFeeCents:
        (profile?.delivery?.mode === 'as_line' && mode === 'delivery')
          ? toCents(deliveryFee)
          : 0,
      // Phase C: jurisdicción por dirección de entrega
      deliveryAddressInfo:
        mode === 'delivery'
          ? ((orderInfo as any)?.addressInfo ?? {
              country: homeAddr?.country || officeAddr?.country,
              city: homeAddr?.city || officeAddr?.city,
              zip: homeAddr?.zip || officeAddr?.zip,
              line1: address || homeAddr?.line1 || officeAddr?.line1,
              notes: (orderInfo as any)?.addressNotes || undefined,
            })
          : null,
    };

    const taxSnapshot = calculateTaxSnapshot(draftInput as any, profile as any);

    // delivery/tip/discount en CENTAVOS (evitar doble conteo si va inside-engine)
    const tipCents = toCents(mode === 'delivery' ? 0 : tip);
    const discountCents = promo?.discountTotalCents ?? 0;

    const deliveryOutsideCents =
      (profile?.delivery?.mode === 'as_line')
        ? 0
        : rawDeliveryFeeCents;

    const grandTotalWithTaxCents =
      (taxSnapshot?.totals?.grandTotalCents || 0)
      + deliveryOutsideCents
      + tipCents
      - discountCents;

    const grandTotalWithTax = grandTotalWithTaxCents / 100;

    // =========================
    // FIN TAX SNAPSHOT
    // =========================

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
      // Mantengo tu total visual actual:
      orderTotal: grandTotal,
      orderInfo: cleanOrderInfo,
      totals: {
        subtotal,
        deliveryFee,
        tip: mode === 'delivery' ? 0 : tip,
        discount: promoDiscountGTQ,
        currency: process.env.NEXT_PUBLIC_PAY_CURRENCY || 'USD',
        // ✅ NUEVO:
        tax: (taxSnapshot?.totals?.taxCents || 0) / 100,
        grandTotalWithTax, // items (+delivery si fuera de engine) + tip - descuento
      },
      // ✅ NUEVO: Totales exactos en centavos
      totalsCents: {
        itemsSubTotalCents: taxSnapshot?.totals?.subTotalCents ?? 0,
        itemsTaxCents: taxSnapshot?.totals?.taxCents ?? 0,
        itemsGrandTotalCents: taxSnapshot?.totals?.grandTotalCents ?? 0,
        deliveryFeeCents: rawDeliveryFeeCents, // persistimos el valor elegido (independiente de si va in-engine)
        tipCents,
        discountCents,
        grandTotalWithTaxCents,
        currency: draftInput.currency,
      },
      // ✅ NUEVO: Snapshot fiscal completo — NORMALIZADO para Firestore
      taxSnapshot: taxSnapshot ? undefToNullDeep(taxSnapshot) : null,

      // Promos
      appliedPromotions,                          // <-- NUEVO
      promotionCode: promo?.code || null,         // <-- NUEVO

      status: 'placed',
      createdAt: serverTimestamp(),
      ...(u ? {
        userEmail: u.email,
        userEmail_lower: u.email?.toLowerCase() || undefined,
        createdBy: { uid: u.uid, email: u.email ?? null }
      } : {}),
    };
  }, [
    address, addressLabel, customerName, customerBillingName, customerTaxId,
    deliveryFee, deliveryOptions, grandTotal, homeAddr, mode, notes, officeAddr, phone,
    selectedDeliveryOptionId, subtotal, table, tip, promoDiscountGTQ, promo,
    // cart.items
  ]);

  return {
    state: {
      mode, table, notes, address, phone, customerName,
      homeAddr, officeAddr, addressLabel, deliveryOptions, selectedDeliveryOptionId,
      tip, tipEdited, saving, payMethod, hasDropdown, subtotal, deliveryFee, grandTotal,
      promoCode, promoApplying, promoError, promo,
      // ✅ NUEVO estado para UI de impuestos
      taxUI,
    },
    actions: {
      setMode, setTable, setNotes, setAddress, setPhone, setAddressLabel,
      setSelectedDeliveryOptionId, setTip, setTipEdited, setSaving, setPayMethod,
      onChangeAddressLabel, setPromoCode, applyPromo, clearPromo,
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
  cart: ReturnType<typeof useCheckoutState>['helpers']['cart'], // ⬅️ nuevo
}) {
  const { state, actions, onSubmitCash, paypalActiveHint, cart } = props;
  const {
    mode, table, notes, address, phone, customerName,
    homeAddr, officeAddr, addressLabel, deliveryOptions, selectedDeliveryOptionId,
    tip, tipEdited, saving, payMethod, hasDropdown, subtotal, deliveryFee, grandTotal,
    promoCode, promoApplying, promoError, promo,
    taxUI,
  } = state;
  const {
    setMode, setTable, setNotes, setAddress, setPhone, setAddressLabel,
    setSelectedDeliveryOptionId, setTip, setTipEdited, setSaving, setPayMethod,
    onChangeAddressLabel, setPromoCode, applyPromo, clearPromo,
  } = actions;

  const disableSubmit =
    saving ||
    (mode === 'dine-in' ? !table.trim() :
     mode === 'delivery' ? !(address && phone && selectedDeliveryOptionId) :
     !phone);

  const showTaxLine = !!taxUI && !taxUI.pricesIncludeTax && taxUI.taxQ > 0;
  const grandToShow = (taxUI?.grandPayableQ ?? grandTotal);

  return (
    <div className="container py-4">
      <h1 className="h4 mb-3">Checkout</h1>

      <div className="row g-4">
        <div className="col-12 col-lg-7">
          <div className="card border-0 shadow-sm">
            <div className="card-header"><div className="fw-semibold">Details</div></div>
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
                    <label className="form-label">Table</label>
                    <input className="form-control" value={table} onChange={(e) => setTable(e.target.value)} placeholder="Ex. Mesa 5" disabled={saving} />
                  </div>
                  <div className="mb-3">
                    <label className="form-label">Notes (optional)</label>
                    <textarea className="form-control" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Additional instructions" disabled={saving} />
                  </div>
                </>
              )}

              {mode === 'delivery' && (
                <>
                  <div className="mb-3">
                    <label className="form-label">Address</label>
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
                                {homeAddr?.city ? `City: ${homeAddr.city}. ` : ''}
                                {homeAddr?.zip ? `ZIP: ${homeAddr.zip}. ` : ''}
                                {homeAddr?.notes ? `Notes: ${homeAddr.notes}.` : ''}
                              </>
                            ) : (
                              <>
                                {officeAddr?.city ? `City: ${officeAddr.city}. ` : ''}
                                {officeAddr?.zip ? `ZIP: ${officeAddr.zip}. ` : ''}
                                {officeAddr?.notes ? `Notes: ${officeAddr.notes}.` : ''}
                              </>
                            )}
                          </div>
                        )}
                      </>
                    ) : (
                      <input className="form-control" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Ex. 5a avenida 10-11..." disabled={saving} />
                    )}
                  </div>

                  <div className="mb-3">
                    <label className="form-label">Phone</label>
                    <input className="form-control" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Ex. 5555-5555" disabled={saving} />
                  </div>

                  <div className="mb-3">
                    <label className="form-label">Delivery options</label>
                    {deliveryOptions.length === 0 ? (
                      <div className="form-text">No shipping options available.</div>
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
                    <label className="form-label">Notes (optional)</label>
                    <textarea className="form-control" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Additional instructions" disabled={saving} />
                  </div>
                </>
              )}

              {mode === 'pickup' && (
                <>
                  <div className="mb-3">
                    <label className="form-label">Phone</label>
                    <input className="form-control" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Ex. 5555-5555" disabled={saving} />
                  </div>
                  <div className="mb-3">
                    <label className="form-label">Notes (optional)</label>
                    <textarea className="form-control" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Additional instructions" disabled={saving} />
                  </div>
                </>
              )}

              {/* --- NUEVO: Código de promoción --- */}
              <div className="mb-3">
                <label className="form-label fw-semibold">Promotion coupon</label>
                <div className="d-flex gap-2">
                  <input
                    className="form-control"
                    placeholder="Ex. DESSERT10"
                    value={promoCode}
                    onChange={(e) => setPromoCode(e.target.value.toUpperCase())}
                    disabled={promoApplying || saving}
                  />
                  {!promo ? (
                    <button className="btn btn-outline-primary" onClick={applyPromo} disabled={promoApplying || saving}>
                      {promoApplying ? 'Applying...' : 'Apply'}
                    </button>
                  ) : (
                    <button className="btn btn-outline-secondary" onClick={clearPromo} disabled={saving}>
                      Remove
                    </button>
                  )}
                </div>
                {promo && (
                  <div className="text-success small mt-1">✓ Coupon applied: <strong>{promo.code}</strong></div>
                )}
                {promoError && (
                  <div className="text-danger small mt-1">{promoError}</div>
                )}
              </div>

              {/* MÉTODO DE PAGO */}
              <div className="mb-3">
                <label className="form-label fw-semibold">Payment Method</label>
                <div className="d-flex flex-column gap-2">
                  <label className="d-flex align-items-center gap-2">
                    <input type="radio" name="pm" className="form-check-input" checked={payMethod==='cash'} onChange={() => setPayMethod('cash')} />
                    <span>Cash</span>
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
                <div className="text-muted small">It will be charged according to the selected method.</div>
                <button
                  className="btn btn-primary"
                  disabled={disableSubmit}
                  onClick={() => {
                    if (payMethod === 'cash') return onSubmitCash();
                    if (payMethod === 'paypal') {
                      alert('Use the PayPal button to continue.');
                    }
                  }}
                >
                  {saving ? 'Processing…' : (payMethod === 'cash' ? 'Confirm order' : 'Pay now')}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Resumen */}
        <div className="col-12 col-lg-5">
          <div className="card border-0 shadow-sm">
            <div className="card-header">
              <div className="fw-semibold">Summary</div>
            </div>
            <div className="card-body">
              {/* Resumen de entrega */}
              {mode === 'delivery' && (
                <div className="border rounded p-2 mb-3 bg-light">
                  <div className="small text-muted">Deliver</div>
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
                    <span className="text-muted">Client:</span> {customerName || '—'}
                    <span className="text-muted ms-2">Phone:</span> {phone || '—'}
                  </div>
                </div>
              )}

              {/* ⬇️ LÍNEAS DEL CARRITO (nuevo) */}
              <div className="d-flex flex-column gap-3 mb-3">
                {cart.items.map((ln: any, idx: number) => {
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
                      {(ln.addons.length > 0 || ln.optionGroups.some((g: any) => g.items.length > 0)) && (
                        <div className="mt-2">
                          {ln.addons.map((ad: any, i: number) => (
                            <div className="d-flex justify-content-between small" key={`ad-${idx}-${i}`}>
                              <div>— (addons) {ad.name}</div>
                              <div>{fmtQ(ad.price)}</div>
                            </div>
                          ))}
                          {ln.optionGroups.map((g: any) =>
                            g.items.map((it: any) => (
                              <div
                                className="d-flex justify-content-between small"
                                key={`gi-${idx}-${g.groupId}-${it.id}`}
                              >
                                <div>— {it.name}</div>
                                <div>{fmtQ(it.priceDelta)}</div>
                              </div>
                            ))
                          )}
                        </div>
                      )}
                      <div className="text-muted small mt-1">
                        ({fmtQ(ln.basePrice + unitExtras)} each)
                      </div>
                    </div>
                  );
                })}
              </div>
              {/* ⬆️ LÍNEAS DEL CARRITO (nuevo) */}
              
              {/* Totales */}
              <div className="mt-3">
                <div className="d-flex justify-content-between">
                  <div>Subtotal</div>
                  <div className="fw-semibold">{fmtQ(subtotal)}</div>
                </div>

                {/* NUEVO: línea de descuento si hay promo */}
                {promo && (
                  <div className="d-flex justify-content-between text-success">
                    <div>Discount ({promo.code})</div>
                    <div className="fw-semibold">- {fmtQ((promo.discountTotalCents||0)/100)}</div>
                  </div>
                )}

                {mode === 'delivery' && (
                  <div className="d-flex justify-content-between">
                    <div>Delivery</div>
                    <div className="fw-semibold">{fmtQ(deliveryFee)}</div>
                  </div>
                )}

                {/* NUEVO: Tax SOLO si el perfil es tax-exclusive */}
                {showTaxLine && (
                  <div className="d-flex justify-content-between">
                    <div>Tax</div>
                    <div className="fw-semibold">{fmtQ(taxUI?.taxQ || 0)}</div>
                  </div>
                )}

                {mode !== 'delivery' && (
                  <div className="d-flex align-items-center justify-content-between gap-2 mt-2">
                    <label className="mb-0">Tip (suggested 10%)</label>
                    <div className="d-flex align-items-center gap-2">
                      <input type="number" min="0" step="0.01" className="form-control form-control-sm" style={{ width: 120 }}
                        value={Number.isFinite(tip) ? tip : 0}
                        onChange={(e) => { setTipEdited(true); const v = Number(e.target.value); setTip(Number.isFinite(v) ? v : 0); }} />
                      <span className="text-muted small">{fmtQ(tip)}</span>
                    </div>
                  </div>
                )}
                <hr />
                <div className="d-flex justify-content-between">
                  <div className="fw-semibold">Grand total</div>
                  <div className="fw-bold">{fmtQ(grandToShow)}</div>
                </div>
              </div>
            </div>
            <div className="card-footer d-flex justify-content-between">
              <div className="small text-muted">Total according to selected method{promo ? ` (includes ${promo.code})` : ''}.</div>
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
      // ✅ Usar total con impuestos cuando esté disponible
      amount: (payload as any).totals?.grandTotalWithTax ?? (payload as any).orderTotal,
      currency: (payload as any).totals?.currency || 'USD',
      createdAt: serverTimestamp(),
    };
    try {
      actions.setSaving(true);
      const ref = await addDoc(collection(db, 'orders'), payload);

      // NUEVO: consumir límite global de la promo (idempotente por orderId)
      if (state.promo?.promoId) {
        try {
          await fetch('/api/promotions/consume', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ promoId: state.promo.promoId, code: state.promo.code, orderId: ref.id }),
          });
        } catch {}
      }

      cart.clear();
      router.push('/cart-new');
      alert('¡Order Created (efectivo)! ID: ' + ref.id);
    } catch (e) {
      console.error(e);
      alert('The order could not be created.');
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
    const currency = process.env.NEXT_PUBLIC_PAY_CURRENCY || 'USD';
    s.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(cid)}&currency=${encodeURIComponent(currency)}`;
    s.async = true;
    s.onload = () => setPaypalReady(true);
    s.onerror = () => console.warn('PayPal could not be loaded SDK.');
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
          const draft = await helpers.buildOrderPayload(); // <-- incluye taxSnapshot y grandTotalWithTax
          const res = await fetch('/api/pay/paypal/create-order', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ orderDraft: draft }),
          });
          if (!res.ok) {
            const j = await res.json().catch(() => null);
            throw new Error(j?.error || 'Could not create PayPal order.');
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
              throw new Error(j?.error || 'Could not capture PayPal.');
            }

            // NUEVO: intentar leer { orderId } para consumir promo
            let captured: any = null;
            try { captured = await res.json(); } catch {}
            const orderId = captured?.orderId;

            if (state.promo?.promoId && orderId) {
              try {
                await fetch('/api/promotions/consume', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ promoId: state.promo.promoId, code: state.promo.code, orderId }),
                });
              } catch {}
            }

            // Cierra el botón ANTES de navegar
            if (paypalButtonsRef.current?.close) {
              try { await paypalButtonsRef.current.close(); } catch {}
              paypalButtonsRef.current = null;
            }

            helpers.cart.clear();
            helpers.router.push('/cart-new');
            alert('PayPal payment captured. Order Confirmed');
          } catch (e: any) {
            alert(e?.message || 'Error capturing PayPal.');
          }
        },
        onError: (err: any) => {
          console.error('PayPal error:', err);
          alert('Error in PayPal.');
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
  }, [state.payMethod, paypalReady, helpers, state.promo]);

  return (
    <CheckoutUI
      state={state}
      actions={actions}
      onSubmitCash={onSubmitCash}
      paypalActiveHint={!process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID ? '(Configura NEXT_PUBLIC_PAYPAL_CLIENT_ID)' : undefined}
      cart={cart} // ⬅️ nuevo
    />
  );
}

/** ------- Export por defecto (solo efectivo + PayPal) ------- */
export default function CheckoutCardsPage() {
  return <CheckoutCoreNoStripe />;
}
