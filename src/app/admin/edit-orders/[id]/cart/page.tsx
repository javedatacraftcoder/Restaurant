// src/app/admin/edit-orders/[id]/cart/page.tsx
"use client";

import { useMemo } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useEditCart } from "@/lib/edit-cart/context";

export default function EditCartPage() {
  const { id } = useParams<{ id: string }>();
  const { cart, updateQuantity, removeLine } = useEditCart();

  const currency = cart.currency ?? "GTQ";

  const amounts = useMemo(() => {
    const subtotal = (cart.lines ?? []).reduce((acc, l) => {
      const price = typeof l.unitPriceCents === "number" && Number.isFinite(l.unitPriceCents)
        ? l.unitPriceCents
        : 0;
      const qty = typeof l.quantity === "number" && Number.isFinite(l.quantity)
        ? l.quantity
        : 1;
      return acc + price * qty;
    }, 0);
    const tip = cart.tipCents ?? 0;
    return {
      subtotalCents: subtotal,
      taxCents: 0,
      serviceFeeCents: 0,
      discountCents: 0,
      tipCents: tip,
      totalCents: subtotal + tip,
    };
  }, [cart.lines, cart.tipCents]);

  const hasZeroPrice = useMemo(
    () => (cart.lines ?? []).some(l => !l.unitPriceCents || l.unitPriceCents <= 0),
    [cart.lines]
  );

  return (
    <div className="container py-3">
      <div className="alert alert-warning mb-3">
        Editando orden <strong>#{(cart.orderId ?? "").slice(-6).toUpperCase()}</strong>
      </div>

      {hasZeroPrice && (
        <div className="alert alert-info py-2">
          Hay ítems con precio 0. Verifica que el catálogo tenga <code>priceCents</code> y que las líneas
          estén rellenas con <code>unitPriceCents</code>.
        </div>
      )}

      <div className="d-flex justify-content-between align-items-center mb-3">
        <h2 className="h6 m-0">Carrito (edición)</h2>
        <div className="d-flex gap-2">
          <Link className="btn btn-sm btn-outline-secondary" href={`/admin/edit-orders/${id}/menu`}>
            Seguir agregando
          </Link>
          <Link className="btn btn-sm btn-success" href={`/admin/edit-orders/${id}/checkout`}>
            Continuar
          </Link>
        </div>
      </div>

      <div className="table-responsive">
        <table className="table table-sm align-middle">
          <thead>
            <tr>
              <th>Item</th>
              <th className="text-center">Cant.</th>
              <th className="text-end">Precio</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {(cart.lines ?? []).map(l => {
              const idStr = String(l.menuItemId ?? "");
              const qty = typeof l.quantity === "number" && Number.isFinite(l.quantity) ? l.quantity : 1;
              const price = typeof l.unitPriceCents === "number" && Number.isFinite(l.unitPriceCents) ? l.unitPriceCents : 0;
              return (
                <tr key={idStr}>
                  <td>{l.name ?? idStr}</td>
                  <td className="text-center" style={{ width: 120 }}>
                    <div className="input-group input-group-sm">
                      <button
                        className="btn btn-outline-secondary"
                        onClick={() => updateQuantity(idStr, Math.max(1, qty - 1))}
                        type="button"
                      >
                        -
                      </button>
                      <input className="form-control text-center" value={qty} readOnly />
                      <button
                        className="btn btn-outline-secondary"
                        onClick={() => updateQuantity(idStr, qty + 1)}
                        type="button"
                      >
                        +
                      </button>
                    </div>
                  </td>
                  <td className="text-end">
                    {((price * qty) / 100).toFixed(2)} {currency}
                  </td>
                  <td className="text-end">
                    <button
                      className="btn btn-sm btn-outline-danger"
                      onClick={() => removeLine(idStr)}
                      type="button"
                    >
                      Quitar
                    </button>
                  </td>
                </tr>
              );
            })}
            {(!cart.lines || cart.lines.length === 0) && (
              <tr>
                <td colSpan={4} className="text-center text-muted">
                  Carrito vacío
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr>
              <th colSpan={2}></th>
              <th className="text-end">Total</th>
              <th className="text-end">{(amounts.totalCents / 100).toFixed(2)} {currency}</th>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
