// src/app/admin/edit-orders/[id]/checkout/page.tsx
"use client";

import { useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useEditCart } from "@/lib/edit-cart/context";
import { apiFetch } from "@/lib/api/client";

export default function EditCheckoutPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { cart, resetAll } = useEditCart();

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Calcula amounts con los mismos campos que usas al crear órdenes
  const amounts = useMemo(() => {
    const subtotal = (cart.lines ?? []).reduce((acc, l) => {
      const price =
        typeof l.unitPriceCents === "number" && Number.isFinite(l.unitPriceCents)
          ? l.unitPriceCents
          : 0;
      const qty =
        typeof l.quantity === "number" && Number.isFinite(l.quantity)
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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const payload = {
      items: (cart.lines ?? []).map((l) => ({
        menuItemId: String(l.menuItemId ?? ""),
        name: l.name, // asegura nombre en la orden
        quantity:
          typeof l.quantity === "number" && Number.isFinite(l.quantity)
            ? l.quantity
            : 1,
        unitPriceCents:
          typeof l.unitPriceCents === "number" && Number.isFinite(l.unitPriceCents)
            ? l.unitPriceCents
            : 0,
        options: (l.selections ?? []).map((g) => ({
          groupId: g.groupId,
          optionItemIds: g.optionItemIds,
        })),
      })),
      currency: cart.currency ?? "GTQ",
      type: cart.type ?? "dine_in",
      tableNumber: (cart.tableNumber ?? "").trim(),
      notes: cart.notes ?? "",
      amounts, // {subtotalCents, taxCents, serviceFeeCents, discountCents, tipCents, totalCents}
    };

    const res = await apiFetch(`/api/orders/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }); // basado en tu handler previo. :contentReference[oaicite:1]{index=1}

    if (res.status === 401) {
      setError("No autorizado. Inicia sesión.");
      setSaving(false);
      router.replace("/login");
      return;
    }
    if (!res.ok) {
      const t = await res.text();
      setError(`Error al guardar cambios: ${t}`);
      setSaving(false);
      return;
    }

    resetAll(); // limpiar el carrito de edición
    router.replace("/admin/edit-orders");
  }

  const currency = cart.currency ?? "GTQ";

  return (
    <div className="container py-3">
      <div className="alert alert-warning mb-3">
        Editando orden{" "}
        <strong>#{(cart.orderId ?? "").slice(-6).toUpperCase()}</strong>
      </div>

      <h2 className="h6 mb-3">Confirmar cambios</h2>

      <form onSubmit={handleSubmit} className="vstack gap-3">
        <div className="card">
          <div className="card-body">
            <div className="mb-2">
              Items: <strong>{(cart.lines ?? []).length}</strong>
            </div>
            <div className="mb-2">
              Subtotal:{" "}
              <strong>
                {(amounts.subtotalCents / 100).toFixed(2)} {currency}
              </strong>
            </div>
            <div className="mb-2">
              Propina:{" "}
              <strong>
                {(amounts.tipCents / 100).toFixed(2)} {currency}
              </strong>
            </div>
            <div className="mb-2">
              Total:{" "}
              <strong>
                {(amounts.totalCents / 100).toFixed(2)} {currency}
              </strong>
            </div>
          </div>
        </div>

        {error && <div className="alert alert-danger">{error}</div>}

        <div className="d-flex gap-2">
          <button className="btn btn-success" disabled={saving}>
            Guardar cambios
          </button>
          <button
            className="btn btn-outline-secondary"
            type="button"
            onClick={() => history.back()}
            disabled={saving}
          >
            Volver
          </button>
        </div>
      </form>
    </div>
  );
}
