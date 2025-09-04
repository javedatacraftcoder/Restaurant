/* src/app/(client)/app/orders/[id]/page.tsx */
"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Protected from "@/components/Protected";
import { useAuth } from "@/app/providers";
import "@/lib/firebase/client";
import { getFirestore, doc, onSnapshot } from "firebase/firestore";

type OpsAddon = { name: string; price?: number };
type OpsGroupItem = { id: string; name: string; priceDelta?: number };
type OpsGroup = { groupId: string; groupName: string; type?: "single" | "multiple"; items: OpsGroupItem[] };
type OpsOption = { groupName: string; selected: Array<{ name: string; priceDelta: number }> };

type OrderDoc = {
  id?: string;
  status?: string;
  total?: number;
  currency?: string;
  items?: Array<{
    menuItemId: string;
    menuItemName?: string;
    quantity: number;
    // Nuevo
    addons?: OpsAddon[];
    optionGroups?: OpsGroup[];
    // Compat viejo
    options?: OpsOption[];
  }>;
  createdAt?: any;

  // autoría
  createdBy?: { uid?: string; email?: string | null } | null;
  userEmail?: string | null;
  userEmail_lower?: string | null;
  contact?: { email?: string | null } | null;
};

function fmtMoneyQ(n: number, cur = "GTQ") {
  const c = (cur || "GTQ").toUpperCase();
  const sym = c === "GTQ" ? "Q" : c === "USD" ? "$" : `${c} `;
  return `${sym}${Number(n || 0).toFixed(2)}`;
}

function PageInner() {
  const params = useParams<{ id: string }>();
  const orderId = params?.id as string;
  const { user } = useAuth();

  const [order, setOrder] = useState<OrderDoc | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const db = getFirestore();
    const ref = doc(db, "orders", orderId);
    const unsub = onSnapshot(
      ref,
      (snap) => {
        setOrder((snap.exists() ? ({ id: snap.id, ...snap.data() } as OrderDoc) : null));
        setLoading(false);
      },
      () => setLoading(false)
    );
    return () => unsub();
  }, [orderId]);

  const owned = useMemo(() => {
    if (!order || !user) return false;
    const uid = user.uid;
    const mail = (user.email || "").toLowerCase();
    return (
      order?.createdBy?.uid === uid ||
      (order?.userEmail || "").toLowerCase() === mail ||
      (order?.userEmail_lower || "").toLowerCase() === mail ||
      (order?.createdBy?.email || "").toLowerCase() === mail ||
      (order?.contact?.email || "").toLowerCase() === mail
    );
  }, [order, user]);

  if (loading) return <div className="container py-4">Cargando orden…</div>;
  if (!order) return <div className="container py-4">Orden no encontrada.</div>;
  if (!owned) return <div className="container py-4 text-danger">No tienes permiso para ver esta orden.</div>;

  return (
    <div className="container py-4">
      <h1 className="h5">Orden #{(order.id || "").slice(0, 6)}</h1>
      <div className="mb-2">
        <span className="text-muted">Estado: </span>
        <b>{(order.status || "placed").toUpperCase()}</b>
      </div>

      <div className="mt-4">
        <h2 className="h6">Productos</h2>

        {Array.isArray(order.items) && order.items.length > 0 ? (
          <ul className="list-group">
            {order.items.map((it, idx) => (
              <li className="list-group-item" key={`${it.menuItemId}-${idx}`}>
                <div className="d-flex justify-content-between">
                  <div className="me-3">
                    <div className="fw-semibold">{it.menuItemName || it.menuItemId}</div>

                    {/* ✅ Addons */}
                    {Array.isArray(it.addons) && it.addons.length > 0 && (
                      <ul className="small text-muted mt-1 ps-3">
                        {it.addons.map((ad, ai) => (
                          <li key={ai}>
                            (addon) {ad.name}
                            {typeof ad.price === "number" ? ` — ${fmtMoneyQ(ad.price, order.currency)}` : ""}
                          </li>
                        ))}
                      </ul>
                    )}

                    {/* ✅ Option groups (nuevo) */}
                    {Array.isArray(it.optionGroups) && it.optionGroups.some(g => (g.items || []).length > 0) && (
                      <ul className="small text-muted mt-1 ps-3">
                        {it.optionGroups.map((g, gi) => (
                          (g.items || []).length > 0 ? (
                            <li key={gi}>
                              <span className="fw-semibold">{g.groupName}:</span>{" "}
                              {(g.items || [])
                                .map(og => `${og.name}${typeof og.priceDelta === "number" ? ` (${fmtMoneyQ(og.priceDelta, order.currency)})` : ""}`)
                                .join(", ")}
                            </li>
                          ) : null
                        ))}
                      </ul>
                    )}

                    {/* Compat: shape viejo con 'options' */}
                    {Array.isArray(it.options) && it.options.length > 0 && (
                      <ul className="small text-muted mt-1 ps-3">
                        {it.options.map((g, gi) => (
                          <li key={gi}>
                            <span className="fw-semibold">{g.groupName}:</span>{" "}
                            {(g.selected || [])
                              .map((s) => `${s.name}${typeof s.priceDelta === "number" ? ` (${fmtMoneyQ(s.priceDelta, order.currency)})` : ""}`)
                              .join(", ")}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div className="text-nowrap">x{it.quantity}</div>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="text-muted">Sin productos</div>
        )}
      </div>
    </div>
  );
}

export default function OrderTrackPage() {
  return (
    <Protected>
      <PageInner />
    </Protected>
  );
}
