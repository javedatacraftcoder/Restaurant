// src/app/admin/edit-orders/page.tsx
"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { useAuth } from "@/app/providers";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api/client"; // <-- NUEVO

type MenuItem = { id: string; name: string; priceCents?: number };

type AnyOrder = {
  id: string;
  number?: string;
  shortId?: string;
  status: string;
  type?: "dine_in" | "delivery" | "pickup" | string;
  tableNumber?: string;
  currency?: string;
  createdAt?: string | Date;
  // OPS model
  items?: Array<{
    menuItemId: string;
    name?: string;
    quantity?: number;
    unitPriceCents?: number;
    priceCents?: number; // por si viene así
    options?: Array<{ groupId: string; optionItemIds: string[] }>;
  }>;
  amounts?: {
    subtotalCents?: number;
    taxCents?: number;
    serviceFeeCents?: number;
    discountCents?: number;
    tipCents?: number;
    totalCents?: number;
    subtotal?: number;
    total?: number;
  };
  // legacy
  lines?: Array<{
    menuItemId: string;
    name?: string;
    qty?: number;
    quantity?: number;
    unitPriceCents?: number;
    priceCents?: number;
  }>;
  totals?: { totalCents?: number; total?: number };
  totalCents?: number;
  total?: number;
};

const ALLOWED = new Set(["placed","kitchen_in_progress","kitchen_done","ready_to_close"]);

function n(x: any, d = 0) {
  const v = Number(x);
  return Number.isFinite(v) ? v : d;
}

function qtyOf(it: any) {
  return n(it?.quantity ?? it?.qty, 1);
}

function priceOf(it: any) {
  return n(it?.unitPriceCents ?? it?.priceCents, 0);
}

function orderNumber(o: AnyOrder) {
  return o.number ?? o.shortId ?? o.id?.slice?.(-6)?.toUpperCase?.() ?? o.id;
}

export default function EditOrdersPage() {
  const { flags, loading } = useAuth();
  const router = useRouter();

  const [orders, setOrders] = useState<AnyOrder[]>([]);
  const [q, setQ] = useState("");
  const [menuMap, setMenuMap] = useState<Record<string, MenuItem>>({});

  // --- cargar menú para resolver nombres si la orden no trae name ---
  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch("/api/menu");
        if (res.status === 401) { router.replace("/login"); return; }
        if (!res.ok) return;
        const m = await res.json();
        const arr: MenuItem[] = (m?.items ?? m ?? []).map((x: any) => ({
          id: x.id,
          name: x.name,
          priceCents: x.priceCents ?? x.price_cents ?? 0,
        }));
        const mp: Record<string, MenuItem> = {};
        for (const it of arr) mp[it.id] = it;
        setMenuMap(mp);
      } catch {
        // ignore
      }
    })();
  }, [router]);

  // --- cargar órdenes editables ---
  useEffect(() => {
    if (loading) return;
    if (!flags.isAdmin && !flags.isWaiter) {
      router.replace("/");
      return;
    }
    (async () => {
      const res = await apiFetch("/api/orders?scope=editable");
      if (res.status === 401) { router.replace("/login"); return; }
      if (!res.ok) return;
      const data = await res.json();
      const list: AnyOrder[] = (data?.orders ?? data ?? []).map((o: any) => ({
        id: o.id,
        number: o.number,
        shortId: o.shortId,
        status: o.status,
        type: o.type,
        tableNumber: o.tableNumber,
        currency: o.currency ?? "GTQ",
        createdAt: o.createdAt,
        items: o.items,
        amounts: o.amounts,
        lines: o.lines,
        totals: o.totals,
        totalCents: o.totalCents,
        total: o.total,
      }));
      const filtered = list.filter(o => ALLOWED.has(o.status));
      setOrders(filtered);
    })();
  }, [flags.isAdmin, flags.isWaiter, loading, router]);

  // --- total robusto ---
  const computeTotalCents = useCallback((o: AnyOrder): number => {
    // 1) variantes directas
    const direct =
      n(o.amounts?.totalCents, NaN) ??
      n(o.amounts?.total, NaN) ??
      n(o.totals?.totalCents, NaN) ??
      n(o.totalCents, NaN) ??
      n(o.total, NaN);
    if (Number.isFinite(direct)) return Number(direct);

    // 2) items / lines
    const src = (Array.isArray(o.items) && o.items.length ? o.items : o.lines) ?? [];
    const sum = src.reduce((acc, it) => acc + priceOf(it) * qtyOf(it), 0);
    return sum;
  }, []);

  // --- resumen de items con nombres (usando menuMap si falta name) ---
  const itemSummary = useCallback((o: AnyOrder): string => {
    const src = Array.isArray(o.items) && o.items.length ? o.items : (o.lines ?? []);
    if (!src.length) return "-";
    const mapped = src.map((it: any) => {
      const baseName = it?.name;
      const byMenu = menuMap[it?.menuItemId]?.name;
      const label = (baseName || byMenu || it?.menuItemId || "").toString();
      return `${label} ×${qtyOf(it)}`;
    });
    const MAX = 4;
    const head = mapped.slice(0, MAX);
    const extra = mapped.length > MAX ? ` +${mapped.length - MAX} más` : "";
    return head.join(", ") + extra;
  }, [menuMap]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return orders
      .filter(o => {
        if (!term) return true;
        const on = (orderNumber(o) || "").toLowerCase();
        return on.includes(term) || o.id.toLowerCase().includes(term);
      })
      .slice(0, 300);
  }, [orders, q]);

  const onEdit = useCallback((id: string) => {
    router.push(`/admin/edit-orders/${id}/menu`);
  }, [router]);

  if (loading) return <div className="container py-4">Cargando…</div>;
  if (!flags.isAdmin && !flags.isWaiter) return null;

  return (
    <div className="container py-4">
      <h1 className="h5 mb-3">Editar órdenes</h1>

      <div className="mb-3 d-flex gap-2">
        <input
          className="form-control"
          placeholder="Buscar por #orden o ID…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      <div className="table-responsive">
        <table className="table table-sm align-middle">
          <thead>
            <tr>
              <th># Orden</th>
              <th>Estado</th>
              <th>Tipo</th>
              <th>Mesa</th>
              <th>Items</th>
              <th className="text-end">Total</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((o) => {
              const totalCents = computeTotalCents(o);
              const isDineIn = (o.type ?? "").toLowerCase() === "dine_in";
              const cur = o.currency ?? "GTQ";
              return (
                <tr key={o.id}>
                  <td>#{orderNumber(o)}</td>
                  <td><span className="badge text-bg-secondary">{o.status}</span></td>
                  <td>{o.type ?? "-"}</td>
                  <td>{isDineIn ? (o.tableNumber || "-") : "-"}</td>
                  <td className="text-truncate" style={{ maxWidth: 420 }}>
                    {itemSummary(o)}
                  </td>
                  <td className="text-end">
                    {cur} {(n(totalCents) / 100).toFixed(2)}
                  </td>
                  <td className="text-end">
                    <button className="btn btn-sm btn-primary" onClick={() => onEdit(o.id)}>
                      Editar
                    </button>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="text-center py-4 text-muted">
                  No hay órdenes editables.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
