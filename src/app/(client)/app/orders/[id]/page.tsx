/* src/app/(client)/app/orders/[id]/page.tsx */
"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Protected from "@/components/Protected";
import { useAuth } from "@/app/providers";
import "@/lib/firebase/client";
import { getFirestore, doc, onSnapshot } from "firebase/firestore";
// CurrencyUpdate: usar el formateador global
import { useFmtQ } from "@/lib/settings/money";

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
    // New
    addons?: OpsAddon[];
    optionGroups?: OpsGroup[];
    // Old compat
    options?: OpsOption[];
  }>;
  createdAt?: any;

  // authorship
  createdBy?: { uid?: string; email?: string | null } | null;
  userEmail?: string | null;
  userEmail_lower?: string | null;
  contact?: { email?: string | null } | null;
};

// CurrencyUpdate: remover fmtMoneyQ local (se reemplaza por useFmtQ)

function PageInner() {
  const params = useParams<{ id: string }>();
  const orderId = params?.id as string;
  const { user } = useAuth();

  const [order, setOrder] = useState<OrderDoc | null>(null);
  const [loading, setLoading] = useState(true);

  // CurrencyUpdate: hook global
  const fmtQ = useFmtQ();

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

  if (loading) return <div className="container py-4">Loading order…</div>;
  if (!order) return <div className="container py-4">Order not found.</div>;
  if (!owned) return <div className="container py-4 text-danger">You don't have permission to view this order.</div>;

  return (
    <div className="container py-4">
      <h1 className="h5">Order #{(order.id || "").slice(0, 6)}</h1>
      <div className="mb-2">
        <span className="text-muted">Status: </span>
        <b>{(order.status || "placed").toUpperCase()}</b>
      </div>

      <div className="mt-4">
        <h2 className="h6">Products</h2>

        {Array.isArray(order.items) && order.items.length > 0 ? (
          <ul className="list-group">
            {order.items.map((it, idx) => (
              <li className="list-group-item" key={`${it.menuItemId}-${idx}`}>
                <div className="d-flex justify-content-between">
                  <div className="me-3">
                    <div className="fw-semibold">{it.menuItemName || it.menuItemId}</div>

                    {/* Addons */}
                    {Array.isArray(it.addons) && it.addons.length > 0 && (
                      <ul className="small text-muted mt-1 ps-3">
                        {it.addons.map((ad, ai) => (
                          <li key={ai}>
                            (addon) {ad.name}
                            {/* CurrencyUpdate */}
                            {typeof ad.price === "number" ? ` — ${fmtQ(ad.price)}` : ""}
                          </li>
                        ))}
                      </ul>
                    )}

                    {/* Option groups */}
                    {Array.isArray(it.optionGroups) && it.optionGroups.some(g => (g.items || []).length > 0) && (
                      <ul className="small text-muted mt-1 ps-3">
                        {it.optionGroups.map((g, gi) => (
                          (g.items || []).length > 0 ? (
                            <li key={gi}>
                              <span className="fw-semibold">{g.groupName}:</span>{" "}
                              {(g.items || [])
                                // CurrencyUpdate
                                .map(og => `${og.name}${typeof og.priceDelta === "number" ? ` (${fmtQ(og.priceDelta)})` : ""}`)
                                .join(", ")}
                            </li>
                          ) : null
                        ))}
                      </ul>
                    )}

                    {/* Compat: forma vieja con 'options' */}
                    {Array.isArray(it.options) && it.options.length > 0 && (
                      <ul className="small text-muted mt-1 ps-3">
                        {it.options.map((g, gi) => (
                          <li key={gi}>
                            <span className="fw-semibold">{g.groupName}:</span>{" "}
                            {(g.selected || [])
                              // CurrencyUpdate
                              .map((s) => `${s.name}${typeof s.priceDelta === "number" ? ` (${fmtQ(s.priceDelta)})` : ""}`)
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
          <div className="text-muted">No products</div>
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
