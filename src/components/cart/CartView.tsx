'use client';

import React, { useMemo } from 'react';
import { useCart } from '@/lib/cart/context';

/**
 * Este componente SOLO LEE del contexto del carrito.
 * No asume métodos, pero si existen (remove, clear, updateQuantity) los usa.
 *
 * Se adapta al shape actual (legacy) y al nuevo con addons + optionGroups:
 *
 * Esperado (nuevo):
 * {
 *   menuItemId: string,
 *   menuItemName: string,
 *   basePrice: number,
 *   quantity: number,
 *   addons?: Array<{ name: string; price: number }>,
 *   optionGroups?: Array<{
 *     groupId: string; groupName: string; type: 'single'|'multi';
 *     items: Array<{ id: string; name: string; priceDelta: number }>
 *   }>,
 *   totalPrice?: number // opcional; se recalcula aquí por seguridad
 * }
 *
 * También soporta legacy:
 * {
 *   id?: string,
 *   name?: string,
 *   price?: number, // precio base
 *   qty?: number,
 *   options?: Array<{ name: string; price?: number }> // si existía algo plano
 * }
 */

type Addon = { name: string; price: number };
type OptionGroupItem = { id: string; name: string; priceDelta: number };
type OptionGroup = {
  groupId: string;
  groupName: string;
  type?: 'single' | 'multi';
  items: OptionGroupItem[];
};

type CartLineNormalized = {
  key: string;
  menuItemId: string;
  name: string;
  basePrice: number;
  quantity: number;
  addons: Addon[];
  optionGroups: OptionGroup[];
};

function fmtQ(n?: number) {
  const v = Number.isFinite(Number(n)) ? Number(n) : 0;
  try { return new Intl.NumberFormat('es-GT', { style: 'currency', currency: 'USD' }).format(v); }
  catch { return `Q ${v.toFixed(2)}`; }
}

function normalizeLine(x: any, index: number): CartLineNormalized {
  const name = x?.menuItemName ?? x?.name ?? 'Producto';
  const basePrice = Number(
    x?.basePrice ??
    x?.price ??
    0
  );
  const quantity = Number(x?.quantity ?? x?.qty ?? 1);
  const menuItemId = String(x?.menuItemId ?? x?.id ?? `idx-${index}`);

  // addons (nuevo) o legacy 'options' (plano) los mostramos como addons si vienen así
  const addons: Addon[] = Array.isArray(x?.addons)
    ? x.addons.map((a: any) => ({ name: String(a?.name ?? ''), price: Number(a?.price ?? 0) }))
    : Array.isArray(x?.options)
      ? x.options.map((o: any) => ({ name: String(o?.name ?? ''), price: Number(o?.price ?? 0) }))
      : [];

  const optionGroups: OptionGroup[] = Array.isArray(x?.optionGroups)
    ? x.optionGroups.map((g: any) => ({
        groupId: String(g?.groupId ?? ''),
        groupName: String(g?.groupName ?? ''),
        type: (g?.type === 'multi' ? 'multi' : 'single'),
        items: Array.isArray(g?.items)
          ? g.items.map((it: any) => ({
              id: String(it?.id ?? ''),
              name: String(it?.name ?? ''),
              priceDelta: Number(it?.priceDelta ?? 0),
            }))
          : [],
      }))
    : [];

  return {
    key: `${menuItemId}:${index}`,
    menuItemId,
    name,
    basePrice,
    quantity,
    addons,
    optionGroups,
  };
}

function lineUnitExtrasTotal(line: CartLineNormalized) {
  let extra = 0;
  for (const ad of line.addons) extra += Number(ad.price || 0);
  for (const g of line.optionGroups) {
    for (const it of g.items) extra += Number(it.priceDelta || 0);
  }
  return extra;
}

function lineTotal(line: CartLineNormalized) {
  const unit = line.basePrice + lineUnitExtrasTotal(line);
  return unit * line.quantity;
}

export default function CartView() {
  const cart = (() => {
    try { return useCart(); } catch { return null as any; }
  })();

  const itemsRaw: any[] = Array.isArray(cart?.items) ? cart.items : [];
  const lines = useMemo(
    () => itemsRaw.map((x, i) => normalizeLine(x, i)),
    [itemsRaw]
  );

  const grandTotal = useMemo(
    () => lines.reduce((acc, ln) => acc + lineTotal(ln), 0),
    [lines]
  );

  const hasRemove = typeof cart?.remove === 'function';
  const hasClear = typeof cart?.clear === 'function';
  const hasUpdateQty = typeof cart?.updateQuantity === 'function';

  return (
    <div className="card border-0 shadow-sm">
      <div className="card-header d-flex align-items-center justify-content-between">
        <div className="fw-semibold">Tu carrito</div>
        {hasClear && itemsRaw.length > 0 && (
          <button className="btn btn-sm btn-outline-danger" onClick={() => cart.clear()}>
            Vaciar
          </button>
        )}
      </div>

      <div className="card-body">
        {lines.length === 0 && (
          <div className="text-muted">Your cart is empty.</div>
        )}

        <div className="d-flex flex-column gap-3">
          {lines.map((ln, idx) => {
            const unitExtras = lineUnitExtrasTotal(ln);
            const lineSum = lineTotal(ln);

            return (
              <div key={ln.key} className="border rounded p-3">
                {/* Encabezado de línea */}
                <div className="d-flex justify-content-between align-items-start">
                  <div className="me-3">
                    <div className="fw-semibold">
                      {ln.name} <span className="text-muted">× {ln.quantity}</span>
                    </div>
                    <div className="text-muted small">
                      Base: {fmtQ(ln.basePrice)} {unitExtras > 0 ? ` · Extras: ${fmtQ(unitExtras)}/u` : ''}
                    </div>
                  </div>
                  <div className="text-end">
                    <div className="fw-semibold">{fmtQ(lineSum)}</div>
                    <div className="text-muted small">({fmtQ(ln.basePrice + unitExtras)} c/u)</div>
                  </div>
                </div>

                {/* Controles de cantidad y eliminar */}
                <div className="mt-2 d-flex align-items-center justify-content-between">
                  {hasUpdateQty ? (
                    <div className="btn-group btn-group-sm">
                      <button
                        className="btn btn-outline-secondary"
                        onClick={() => cart.updateQuantity(ln.menuItemId, Math.max(1, ln.quantity - 1))}
                      >−</button>
                      <button className="btn btn-outline-secondary" disabled>{ln.quantity}</button>
                      <button
                        className="btn btn-outline-secondary"
                        onClick={() => cart.updateQuantity(ln.menuItemId, ln.quantity + 1)}
                      >+</button>
                    </div>
                  ) : <div />}

                  {hasRemove && (
                    <button className="btn btn-sm btn-outline-danger" onClick={() => cart.remove(ln.menuItemId)}>
                      Remove
                    </button>
                  )}
                </div>

                {/* Desglose “bonito” */}
                {(ln.addons.length > 0 || ln.optionGroups.some(g => g.items.length > 0)) && (
                  <div className="mt-3">
                    {ln.addons.length > 0 && (
                      <div className="mb-1">
                        {ln.addons.map((ad, i) => (
                          <div className="d-flex justify-content-between small" key={`ad-${i}`}>
                            <div>— (addons) {ad.name}</div>
                            <div>{fmtQ(ad.price)}</div>
                          </div>
                        ))}
                      </div>
                    )}

                    {ln.optionGroups.map((g) => (
                      g.items.length > 0 && (
                        <div className="mb-1" key={`g-${g.groupId}`}>
                          {g.items.map((it) => (
                            <div className="d-flex justify-content-between small" key={`g-${g.groupId}-${it.id}`}>
                              <div>— (groupitems) {it.name}</div>
                              <div>{fmtQ(it.priceDelta)}</div>
                            </div>
                          ))}
                        </div>
                      )
                    ))}
                  </div>
                )}

                {/* Total de la línea, como en tu ejemplo */}
                <div className="mt-2 border-top pt-2 d-flex justify-content-between">
                  <div className="fw-semibold">Total</div>
                  <div className="fw-semibold">{fmtQ(lineSum)}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Pie con total general */}
      <div className="card-footer d-flex justify-content-between align-items-center">
        <div className="fw-semibold">Total to pay</div>
        <div className="fw-bold fs-5">{fmtQ(grandTotal)}</div>
      </div>
    </div>
  );
}
