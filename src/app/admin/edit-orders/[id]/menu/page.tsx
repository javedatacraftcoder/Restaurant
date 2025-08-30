"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/app/providers";
import { useEditCart } from "@/lib/edit-cart/context";
import Link from "next/link";
import { apiFetch } from "@/lib/api/client";

type MenuItem = {
  id: string;
  name: string;
  priceCents: number;          // normalizamos a cents
  description?: string;
};

function toPriceCents(x: any): number {
  if (Number.isFinite(+x?.priceCents)) return +x.priceCents;
  if (Number.isFinite(+x?.price_cents)) return +x.price_cents;
  if (Number.isFinite(+x?.price)) return Math.round(+x.price * 100);
  return 0;
}

export default function EditMenuPage() {
  const { id } = useParams<{ id: string }>();
  const { flags, loading } = useAuth();
  const { cart, loadFromOrderDoc, addLine, setCart } = useEditCart();
  const router = useRouter();

  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [menuMap, setMenuMap] = useState<Record<string, MenuItem>>({});
  const [loadingAll, setLoadingAll] = useState(true);

  useEffect(() => {
    if (loading) return;
    if (!flags.isAdmin && !flags.isWaiter) { router.replace("/"); return; }

    (async () => {
      // 1) Cargar orden
      const res = await apiFetch(`/api/orders/${id}`);
      if (res.status === 401) { router.replace("/login"); return; }
      if (!res.ok) { router.replace("/admin/edit-orders"); return; }
      const order = await res.json();
      loadFromOrderDoc(order, id);

      // 2) Cargar menú y normalizar
      const mRes = await apiFetch("/api/menu");
      const raw = await mRes.json();
      const normalized: MenuItem[] = (raw?.items ?? raw ?? []).map((x: any) => ({
        id: String(x.id),
        name: x.name,
        priceCents: toPriceCents(x),
        description: x.description ?? "",
      }));
      setMenu(normalized);
      const mp: Record<string, MenuItem> = {};
      for (const it of normalized) mp[it.id] = it;
      setMenuMap(mp);

      // 3) Backfill de líneas sin precio/nombre
      setCart(c => ({
        ...c,
        lines: (c.lines ?? []).map(l => {
          const idStr = String(l.menuItemId ?? "");
          const fromMenu = mp[idStr];
          const price =
            typeof l.unitPriceCents === "number" && Number.isFinite(l.unitPriceCents)
              ? l.unitPriceCents
              : (fromMenu?.priceCents ?? 0);

          return {
            ...l,
            menuItemId: idStr,
            unitPriceCents: price,
            name: l.name ?? fromMenu?.name ?? idStr,
          };
        }),
      }));

      setLoadingAll(false);
    })();
  }, [id, flags.isAdmin, flags.isWaiter, loading, router, loadFromOrderDoc, setCart]);

  if (loading || loadingAll) return <div className="container py-4">Cargando…</div>;

  return (
    <div className="container py-3">
      <div className="alert alert-warning mb-3">
        Editando orden <strong>#{(cart.orderId ?? "").slice(-6).toUpperCase()}</strong>
      </div>

      <div className="d-flex justify-content-between align-items-center mb-2">
        <h2 className="h6 m-0">Menú (edición)</h2>
        <div className="d-flex gap-2">
          <Link className="btn btn-sm btn-outline-secondary" href={`/admin/edit-orders/${id}/cart`}>Ver carrito</Link>
          <Link className="btn btn-sm btn-success" href={`/admin/edit-orders/${id}/checkout`}>Continuar</Link>
        </div>
      </div>

      <div className="row g-3">
        {menu.map(i => (
          <div className="col-12 col-md-6 col-lg-4" key={i.id}>
            <div className="card h-100">
              <div className="card-body">
                <div className="d-flex justify-content-between">
                  <h3 className="h6">{i.name}</h3>
                  <span className="badge text-bg-light">{(i.priceCents/100).toFixed(2)} GTQ</span>
                </div>
                {i.description && <p className="text-muted small mb-3">{i.description}</p>}
                <button
                  className="btn btn-sm btn-primary"
                  onClick={() =>
                    addLine({
                      menuItemId: i.id,
                      name: i.name,
                      quantity: 1,
                      unitPriceCents: i.priceCents,
                      selections: [],
                    })
                  }
                >
                  Agregar
                </button>
              </div>
            </div>
          </div>
        ))}
        {menu.length === 0 && <div className="col-12 text-muted">No hay productos</div>}
      </div>
    </div>
  );
}
