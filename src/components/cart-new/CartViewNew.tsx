'use client';

import React, { useMemo } from 'react';
import Link from 'next/link';
import { useNewCart } from '@/lib/newcart/context';
import type { NewCartItem } from '@/lib/newcart/types';

function fmtQ(n?: number) {
  const v = Number.isFinite(Number(n)) ? Number(n) : 0;
  try { return new Intl.NumberFormat('es-GT', { style: 'currency', currency: 'USD' }).format(v); }
  catch { return `Q ${v.toFixed(2)}`; }
}

export default function CartViewNew() {
  const cart = useNewCart();

  const lines: NewCartItem[] = cart.items;
  const grand = useMemo(() => cart.computeGrandTotal(), [cart, lines]);

  return (
    <div className="card border-0 shadow-sm">
      <div className="card-header d-flex align-items-center justify-content-between">
        <div className="fw-semibold">Your Cart</div>
        {lines.length > 0 && (
          <button className="btn btn-sm btn-outline-danger" onClick={() => cart.clear()}>Empty</button>
        )}
      </div>

      <div className="card-body">
        {lines.length === 0 && <div className="text-muted">Your cart is empty.</div>}

        <div className="d-flex flex-column gap-3">
          {lines.map((ln, idx) => {
            const unitExtras = cart.computeLineTotal({ ...ln, quantity: 1 }) - ln.basePrice;
            const lineSum = cart.computeLineTotal(ln);
            return (
              <div key={`${ln.menuItemId}-${idx}`} className="border rounded p-3">
                <div className="d-flex justify-content-between align-items-start">
                  <div className="me-3">
                    <div className="fw-semibold">
                      {ln.menuItemName} <span className="text-muted">× {ln.quantity}</span>
                    </div>
                    <div className="text-muted small">
                      Base: {fmtQ(ln.basePrice)} {unitExtras > 0 ? `· Extras: ${fmtQ(unitExtras)}/u` : ''}
                    </div>
                  </div>
                  <div className="text-end">
                    <div className="fw-semibold">{fmtQ(lineSum)}</div>
                    <div className="text-muted small">({fmtQ(ln.basePrice + unitExtras)} c/u)</div>
                  </div>
                </div>

                <div className="mt-2 d-flex align-items-center justify-content-between">
                  <div className="btn-group btn-group-sm">
                    <button className="btn btn-outline-secondary" onClick={() => cart.updateQuantity(idx, Math.max(1, (ln.quantity || 1) - 1))}>−</button>
                    <button className="btn btn-outline-secondary" disabled>{ln.quantity}</button>
                    <button className="btn btn-outline-secondary" onClick={() => cart.updateQuantity(idx, (ln.quantity || 1) + 1)}>+</button>
                  </div>
                  <button className="btn btn-sm btn-outline-danger" onClick={() => cart.remove(idx)}>Quitar</button>
                </div>

                {(ln.addons.length > 0 || ln.optionGroups.some(g => g.items.length > 0)) && (
                  <div className="mt-3">
                    {ln.addons.length > 0 && (
                      <div className="mb-1">
                        {ln.addons.map((ad, i) => (
                          <div className="d-flex justify-content-between small" key={`ad-${idx}-${i}`}>
                            <div>— (addons) {ad.name}</div>
                            <div>{fmtQ(ad.price)}</div>
                          </div>
                        ))}
                      </div>
                    )}

                    {ln.optionGroups.map((g) => (
                      g.items.length > 0 && (
                        <div className="mb-1" key={`g-${idx}-${g.groupId}`}>
                          {g.items.map((it) => (
                            <div className="d-flex justify-content-between small" key={`gi-${idx}-${g.groupId}-${it.id}`}>
                              <div>— (groupitems) {it.name}</div>
                              <div>{fmtQ(it.priceDelta)}</div>
                            </div>
                          ))}
                        </div>
                      )
                    ))}
                  </div>
                )}

                <div className="mt-2 border-top pt-2 d-flex justify-content-between">
                  <div className="fw-semibold">Total</div>
                  <div className="fw-semibold">{fmtQ(lineSum)}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="card-footer d-flex justify-content-between align-items-center">
        <div className="fw-semibold">Total to pay</div>
        <div className="d-flex align-items-center gap-2">
          <div className="fw-bold fs-5">{fmtQ(grand)}</div>
          <Link href="/checkout-new" className="btn btn-primary">Go to checkout</Link>
        </div>
      </div>
    </div>
  );
}
