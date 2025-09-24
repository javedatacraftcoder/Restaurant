"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Protected from "@/components/Protected";
import { useAuth } from "@/app/providers";
import "@/lib/firebase/client";
import { getFirestore, doc, onSnapshot } from "firebase/firestore";
import { useFmtQ } from "@/lib/settings/money";

// i18n
import { t, getLang } from "@/lib/i18n/t";
import { useTenantSettings } from "@/lib/settings/hooks";

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

function PageInner() {
  const params = useParams<{ id: string }>();
  const orderId = params?.id as string;
  const { user } = useAuth();

  const [order, setOrder] = useState<OrderDoc | null>(null);
  const [loading, setLoading] = useState(true);

  // currency (global)
  const fmtQ = useFmtQ();

  // idioma
  const { settings } = useTenantSettings();
  const rawLang =
    (settings as any)?.language ??
    (typeof window !== "undefined" ? localStorage.getItem("tenant.language") || undefined : undefined);
  const lang = getLang(rawLang);

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

  if (loading) return <div className="container py-4">{t(lang, "orderDetail.loading")}</div>;
  if (!order) return <div className="container py-4">{t(lang, "orderDetail.notFound")}</div>;
  if (!owned) return <div className="container py-4 text-danger">{t(lang, "orderDetail.noPermission")}</div>;

  return (
    <div className="container py-4">
      <h1 className="h5">
        {t(lang, "orders.order")} #{(order.id || "").slice(0, 6)}
      </h1>
      <div className="mb-2">
        <span className="text-muted">{t(lang, "orders.status")}: </span>
        <b>{(order.status || "placed").toUpperCase()}</b>
      </div>

      <div className="mt-4">
        <h2 className="h6">{t(lang, "orders.products")}</h2>

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
                            {t(lang, "orders.addonTag")} {ad.name}
                            {typeof ad.price === "number" ? ` — ${fmtQ(ad.price)}` : ""}
                          </li>
                        ))}
                      </ul>
                    )}

                    {/* Option groups */}
                    {Array.isArray(it.optionGroups) && it.optionGroups.some(g => (g.items || []).length > 0) && (
                      <ul className="small text-muted mt-1 ps-3">
                        {it.optionGroups.map((g, gi) =>
                          (g.items || []).length > 0 ? (
                            <li key={gi}>
                              <span className="fw-semibold">{g.groupName}:</span>{" "}
                              {(g.items || [])
                                .map(og => `${og.name}${typeof og.priceDelta === "number" ? ` (${fmtQ(og.priceDelta)})` : ""}`)
                                .join(", ")}
                            </li>
                          ) : null
                        )}
                      </ul>
                    )}

                    {/* Compat: forma vieja con 'options' */}
                    {Array.isArray(it.options) && it.options.length > 0 && (
                      <ul className="small text-muted mt-1 ps-3">
                        {it.options.map((g, gi) => (
                          <li key={gi}>
                            <span className="fw-semibold">{g.groupName}:</span>{" "}
                            {(g.selected || [])
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
          <div className="text-muted">{t(lang, "orderDetail.noProducts")}</div>
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
