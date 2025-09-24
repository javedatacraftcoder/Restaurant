"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Protected from "@/components/Protected";
import { useAuth } from "@/app/providers";
import { useFmtQ } from "@/lib/settings/money";

// i18n
import { t, getLang } from "@/lib/i18n/t";
import { useTenantSettings } from "@/lib/settings/hooks";

/*Expected data types*/

type FirestoreTS =
  | { seconds: number; nanoseconds?: number }
  | Date
  | null
  | undefined;

type OpsOption = { groupName: string; selected: Array<{ name: string; priceDelta?: number; priceDeltaCents?: number }> };

// shape used by checkout (addons + optionGroups.items)
type OpsAddon = { name: string; price?: number; priceCents?: number };
type OpsGroupItem = { id: string; name: string; priceDelta?: number; priceDeltaCents?: number };
type OpsGroup = { groupId: string; groupName: string; type?: "single" | "multiple"; items: OpsGroupItem[] };

type OpsItem = {
  menuItemId: string;
  menuItemName?: string;
  quantity: number;
  options?: OpsOption[];
  addons?: OpsAddon[];
  optionGroups?: OpsGroup[];

  // ⚠️ Compat (por si vienen en la orden aunque no estén tipados originalmente)
  unitPrice?: number;
  unitPriceCents?: number;
  basePrice?: number;
  basePriceCents?: number;
  price?: number;
  priceCents?: number;
  totalCents?: number;
  menuItem?: { price?: number; priceCents?: number } | null;
};

type LegacyLine = {
  itemId?: string;
  name?: string;
  qty?: number;
  unitPriceCents?: number;
  totalCents?: number;
};

type Order = {
  id: string;
  status?: string;
  currency?: string;
  createdAt?: FirestoreTS;
  updatedAt?: FirestoreTS;
  notes?: string | null;

  // OPS (ambas variantes)
  items?: OpsItem[];

  // Totales
  amounts?: {
    subtotal: number;
    tax?: number;
    serviceFee?: number;
    discount?: number;
    tip?: number;
    total: number;
  } | null;

  // LEGACY
  lines?: LegacyLine[];
  totals?: { totalCents?: number } | null;

  // authorship
  createdBy?: { uid?: string; email?: string | null } | null;
  userEmail?: string | null;
  userEmail_lower?: string | null;
  contact?: { email?: string | null } | null;

  // Invoice info (persistido en orders)
  invoiceNumber?: string | null;
  invoiceDate?: FirestoreTS;
};

type ApiList = { ok?: boolean; orders?: Order[]; error?: string };

/* Helper para formateado de fechas*/
function tsToDate(ts: any): Date | null {
  if (!ts) return null;

  if (ts instanceof Date) return isNaN(ts.getTime()) ? null : ts;

  if (typeof ts?.toDate === "function") {
    const d = ts.toDate();
    return d instanceof Date && !isNaN(d.getTime()) ? d : null;
  }

  if (typeof ts === "object") {
    const seconds = ts.seconds ?? ts._seconds ?? ts.$seconds ?? null;
    const nanos = ts.nanoseconds ?? ts._nanoseconds ?? ts.nanos ?? 0;
    if (seconds != null) {
      const ms = seconds * 1000 + Math.floor((nanos || 0) / 1e6);
      const d = new Date(ms);
      if (!isNaN(d.getTime())) return d;
    }
    const iso = ts.$date ?? ts.iso ?? ts.date ?? null;
    if (typeof iso === "string") {
      const d = new Date(iso);
      if (!isNaN(d.getTime())) return d;
    }
  }

  if (typeof ts === "string") {
    const d = new Date(ts);
    if (!isNaN(d.getTime())) return d;
    const n = Number(ts);
    if (Number.isFinite(n)) {
      const ms = n > 1e12 ? n : n * 1000;
      const d2 = new Date(ms);
      if (!isNaN(d2.getTime())) return d2;
    }
    return null;
  }

  if (typeof ts === "number") {
    const ms = ts > 1e12 ? ts : ts * 1000;
    const d = new Date(ms);
    return isNaN(d.getTime()) ? null : d;
  }

  return null;
}

function fmtDate(ts?: FirestoreTS) {
  const d = tsToDate(ts || null);
  if (!d) return "-";
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString()}`;
}

/*Helper para precios (OPS) */
const toNum = (x: any) => (Number.isFinite(Number(x)) ? Number(x) : undefined);
const centsToQ = (c?: number) => (Number.isFinite(c) ? Number(c) / 100 : 0);

function priceDeltaQ(x: { priceDelta?: number; priceDeltaCents?: number } | any): number {
  const a = toNum(x?.priceDelta);       if (a !== undefined) return a;
  const ac = toNum(x?.priceDeltaCents); if (ac !== undefined) return ac / 100;
  return 0;
}
function priceQ(x: { price?: number; priceCents?: number } | any): number {
  const p = toNum(x?.price);       if (p !== undefined) return p;
  const pc = toNum(x?.priceCents); if (pc !== undefined) return pc / 100;
  return 0;
}

function perUnitAddonsQ(it: OpsItem | any): number {
  let sum = 0;

  if (Array.isArray(it?.optionGroups)) {
    for (const g of it.optionGroups) {
      for (const og of (g?.items || [])) sum += priceDeltaQ(og);
    }
  }

  if (Array.isArray(it?.options)) {
    for (const g of it.options) {
      for (const s of (g?.selected || [])) sum += priceDeltaQ(s);
    }
  }

  if (Array.isArray(it?.addons)) {
    for (const ad of it.addons) sum += priceQ(ad);
  }

  return sum;
}

function baseUnitPriceQ(it: OpsItem | any): number {
  const base = toNum(it?.basePrice);
  if (base !== undefined) return base;

  const baseC = toNum(it?.basePriceCents);
  if (baseC !== undefined) return baseC / 100;

  const up = toNum(it?.unitPrice);
  if (up !== undefined) return up;

  const upC = toNum(it?.unitPriceCents);
  if (upC !== undefined) return upC / 100;

  const p = toNum(it?.price);
  if (p !== undefined) return p;

  const pC = toNum(it?.priceCents);
  if (pC !== undefined) return pC / 100;

  const miC = toNum(it?.menuItem?.priceCents);
  if (miC !== undefined) return miC / 100;

  const mi = toNum(it?.menuItem?.price);
  if (mi !== undefined) return mi;

  const qty = Number(it?.quantity || 1);
  const totC = toNum(it?.totalCents);
  if (totC !== undefined && qty > 0) {
    const per = totC / 100 / qty;
    const addons = perUnitAddonsQ(it);
    return Math.max(0, per - addons);
  }

  return 0;
}

function lineTotalOpsQ(it: OpsItem | any): number {
  const qty = Number(it?.quantity || 1);
  const baseUnit = baseUnitPriceQ(it);
  const addonsUnit = perUnitAddonsQ(it);
  const totC = toNum(it?.totalCents);
  if (totC !== undefined) return totC / 100;
  return (baseUnit + addonsUnit) * qty;
}

function computeFromItems(o: Order): { subtotal: number; total: number } {
  const items = Array.isArray(o.items) ? o.items : [];
  const subtotal = items.reduce((acc, it) => acc + lineTotalOpsQ(it), 0);
  const tip = Number(o.amounts?.tip || 0);
  const total = Number.isFinite(Number(o.amounts?.total))
    ? Number(o.amounts!.total)
    : subtotal + tip;
  return { subtotal, total };
}

function orderTotal(order: Order): number {
  if (order.amounts && typeof order.amounts.total === "number") return Number(order.amounts.total || 0);

  const cents =
    (order.totals?.totalCents ?? null) != null
      ? Number(order.totals!.totalCents!)
      : Array.isArray(order.lines)
      ? order.lines.reduce((acc, l) => acc + (Number(l.totalCents || 0)), 0)
      : 0;
  const legacy = cents / 100;

  if (!legacy && Array.isArray(order.items) && order.items.length) {
    return computeFromItems(order).total;
  }

  return legacy;
}

function lineName(l: LegacyLine) {
  return (l.name && String(l.name)) || (l.itemId && `Item ${l.itemId}`) || "Item";
}

function closedStatus(s?: string) {
  const v = (s || "").toLowerCase();
  return v === "closed" || v === "cancelled" ? v : null;
}

/** Status label i18n (usamos las mismas claves de tracking) */
type StatusSnake =
  | "cart"
  | "placed"
  | "kitchen_in_progress"
  | "kitchen_done"
  | "ready_to_close"
  | "assigned_to_courier"
  | "on_the_way"
  | "delivered"
  | "closed"
  | "cancelled";

function toSnakeStatus(s: string): StatusSnake {
  const snake = s?.includes("_") ? s : s?.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
  const alias: Record<string, StatusSnake> = {
    ready: "ready_to_close",
    served: "ready_to_close",
    completed: "closed",
    ready_for_delivery: "assigned_to_courier",
    out_for_delivery: "on_the_way",
  };
  return (alias[snake] ?? (snake as StatusSnake)) || "placed";
}

const STATUS_LABEL_KEYS: Record<StatusSnake, string> = {
  cart: "track.status.cart",
  placed: "track.status.received",
  kitchen_in_progress: "track.status.inKitchen",
  kitchen_done: "track.status.kitchenReady",
  ready_to_close: "track.status.readyToClose",
  assigned_to_courier: "track.status.assigned",
  on_the_way: "track.status.onTheWay",
  delivered: "track.status.delivered",
  closed: "track.status.closed",
  cancelled: "track.status.cancelled",
};

function statusLabel(lang: string, s?: string) {
  const key = STATUS_LABEL_KEYS[toSnakeStatus(String(s || "placed"))];
  return t(lang, key);
}

/** --------------------------
 *  Page (inner)
 *  -------------------------- */
function ClientOrdersPageInner() {
  const { user, idToken } = useAuth();
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);

  const { settings } = useTenantSettings();
  const rawLang =
    (settings as any)?.language ??
    (typeof window !== "undefined" ? localStorage.getItem("tenant.language") || undefined : undefined);
  const lang = getLang(rawLang);

  const fmtQ = useFmtQ();

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        setErr(null);

        const headers: HeadersInit = {};
        if (idToken) headers["Authorization"] = `Bearer ${idToken}`;

        const res = await fetch(`/api/orders?limit=200`, {
          cache: "no-store",
          headers,
        });
        const data: ApiList = await res.json().catch(() => ({} as any));
        if (!res.ok || data?.ok === false) throw new Error(data?.error || `HTTP ${res.status}`);

        const uid = user?.uid || "";
        const mail = (user as any)?.email?.toLowerCase() || "";

        const mine = (data.orders || []).filter((o) => {
          const byUid = (o.createdBy?.uid || "") === uid;
          const byMail =
            (o.userEmail || "").toLowerCase() === mail ||
            (o.userEmail_lower || "").toLowerCase() === mail ||
            (o.createdBy?.email || "").toLowerCase() === mail ||
            (o.contact?.email || "").toLowerCase() === mail;
          return byUid || byMail;
        });

        mine.sort((a, b) => {
          const da = tsToDate(a.createdAt)?.getTime() ?? 0;
          const db = tsToDate(b.createdAt)?.getTime() ?? 0;
          return db - da;
        });

        if (alive) setOrders(mine);
      } catch (e: any) {
        if (alive) setErr(e?.message || "Could not load orders");
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [user?.uid, (user as any)?.email, idToken]);

  const totalOrders = orders.length;

  return (
    <div className="container py-4">
      <div className="d-flex align-items-center justify-content-between mb-3">
        <h1 className="h5 m-0">{t(lang, "orders.title")}</h1>
        <span className="text-muted small">{t(lang, "orders.totalPrefix")} {totalOrders}</span>
      </div>

      {loading && <div className="alert alert-info">{t(lang, "orders.loading")}</div>}
      {err && <div className="alert alert-danger">{t(lang, "common.errorPrefix")} {err}</div>}

      {!loading && !err && totalOrders === 0 && (
        <div className="alert alert-secondary">
          {t(lang, "orders.empty.before")}{" "}
          <Link href="/menu">{t(lang, "orders.menuLink")}</Link>{" "}
          {t(lang, "orders.empty.after")}
        </div>
      )}

      {!loading && !err && totalOrders > 0 && (
        <div className="list-group">
          {orders.map((o) => {
            const total = orderTotal(o);
            const isOpen = openId === o.id;
            const closed = !!closedStatus(o.status);
            const pillClass = closed ? "bg-danger" : "bg-primary";

            const computed = !o.amounts && Array.isArray(o.items) && o.items.length
              ? computeFromItems(o)
              : null;

            return (
              <div key={o.id} className="list-group-item p-0 border-0 mb-3">
                <div className="card shadow-sm">
                  <div className="card-body d-flex flex-column flex-md-row justify-content-between align-items-start align-items-md-center">
                    <div className="me-md-3">
                      <div className="d-flex align-items-center flex-wrap gap-2">
                        <span className="fw-semibold">{t(lang, "orders.order")} #{o.id.slice(0, 6)}</span>
                        <span className={`badge rounded-pill ${pillClass}`}>{statusLabel(lang, o.status)}</span>
                      </div>
                      <div className="small text-muted mt-1">{t(lang, "orders.date")}: {fmtDate(o.createdAt)}</div>

                      {(o.invoiceNumber || o.invoiceDate) && (
                        <div className="small text-muted">
                          {t(lang, "orders.invoice")}: {o.invoiceNumber || "-"}{o.invoiceDate ? ` • ${fmtDate(o.invoiceDate)}` : ""}
                        </div>
                      )}
                    </div>
                    <div className="mt-2 mt-md-0 fw-bold">
                      {fmtQ(total)}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="card-footer d-flex gap-2">
                    <button
                      type="button"
                      className="btn btn-outline-secondary btn-sm"
                      onClick={() => setOpenId(isOpen ? null : o.id)}
                    >
                      {isOpen ? t(lang, "orders.hideDetails") : t(lang, "orders.viewDetails")}
                    </button>
                    <Link href={`/app/orders/${o.id}`} className="btn btn-outline-primary btn-sm">
                      {t(lang, "orders.openShare")}
                    </Link>
                  </div>

                  {/* Detalle inline expandible */}
                  {isOpen && (
                    <div className="card-footer bg-white">
                      {/* OPS items */}
                      {Array.isArray(o.items) && o.items.length > 0 && (
                        <div className="mb-3">
                          <div className="fw-semibold mb-2">{t(lang, "orders.products")}</div>
                          <ul className="list-group">
                            {o.items.map((it, idx) => {
                              const lineTotal = lineTotalOpsQ(it);
                              const qty = Number(it.quantity || 1);

                              return (
                                <li className="list-group-item" key={`${it.menuItemId}-${idx}`}>
                                  <div className="d-flex justify-content-between">
                                    <div>
                                      <div className="fw-semibold">
                                        {it.menuItemName || it.menuItemId}
                                      </div>

                                      {/* addons */}
                                      {Array.isArray(it.addons) && it.addons.length > 0 && (
                                        <ul className="small text-muted mt-1 ps-3">
                                          {it.addons.map((ad, ai) => {
                                            const q = priceQ(ad);
                                            return (
                                              <li key={ai}>
                                                {t(lang, "orders.addonTag")} {ad.name}
                                                {q ? ` — ${fmtQ(q)}` : ""}
                                              </li>
                                            );
                                          })}
                                        </ul>
                                      )}

                                      {/* optionGroups.items */}
                                      {Array.isArray(it.optionGroups) && it.optionGroups.some(g => (g.items || []).length > 0) && (
                                        <ul className="small text-muted mt-1 ps-3">
                                          {it.optionGroups.map((g, gi) => {
                                            const list = (g.items || []);
                                            if (!list.length) return null;
                                            const rows = list.map((og, i) => {
                                              const d = priceDeltaQ(og);
                                              return `${og.name}${d ? ` (${fmtQ(d)})` : ""}`;
                                            }).join(", ");
                                            return (
                                              <li key={gi}>
                                                <span className="fw-semibold">{g.groupName}:</span> {rows}
                                              </li>
                                            );
                                          })}
                                        </ul>
                                      )}

                                      {/* options */}
                                      {Array.isArray(it.options) && it.options.length > 0 && (
                                        <ul className="small text-muted mt-1 ps-3">
                                          {it.options.map((g, gi) => {
                                            const rows = (g.selected || []).map((s) => {
                                              const d = priceDeltaQ(s);
                                              return `${s.name}${d ? ` (${fmtQ(d)})` : ""}`;
                                            }).join(", ");
                                            return (
                                              <li key={gi}>
                                                <span className="fw-semibold">{g.groupName}:</span> {rows}
                                              </li>
                                            );
                                          })}
                                        </ul>
                                      )}

                                      {/* ninguno */}
                                      {!((it.addons && it.addons.length) ||
                                         (it.optionGroups && it.optionGroups.some(g => (g.items || []).length > 0)) ||
                                         (it.options && it.options.length)) && (
                                        <div className="small text-muted">{t(lang, "orders.noAddons")}</div>
                                      )}
                                    </div>

                                    {/* Monto por línea */}
                                    <div className="ms-3 text-nowrap">
                                      {fmtQ(lineTotal)}
                                      <div className="small text-muted text-end">x{qty}</div>
                                    </div>
                                  </div>
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      )}

                      {/* LEGACY lines */}
                      {Array.isArray(o.lines) && o.lines.length > 0 && (
                        <div className="mb-3">
                          <div className="fw-semibold mb-2">{t(lang, "orders.products")}</div>
                          <ul className="list-group">
                            {o.lines.map((l, idx) => {
                              const qty = Number(l.qty || 1);
                              const unitQ = Number(l.unitPriceCents || 0) / 100;
                              const totalQ =
                                typeof l.totalCents === "number"
                                  ? l.totalCents / 100
                                  : Math.max(0, unitQ * qty);
                              return (
                                <li className="list-group-item" key={idx}>
                                  <div className="d-flex justify-content-between">
                                    <div>
                                      <div className="fw-semibold">{lineName(l)}</div>
                                      <div className="small text-muted">x{qty}</div>
                                    </div>
                                    <div className="ms-3 text-nowrap">
                                      {fmtQ(totalQ)}
                                    </div>
                                  </div>
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      )}

                      {/* Totales y notas */}
                      <div className="row g-2">
                        {o.notes ? (
                          <div className="col-12">
                            <div className="small">
                              <span className="text-muted">{t(lang, "orders.notes")}: </span>
                              {o.notes}
                            </div>
                          </div>
                        ) : null}

                        {/* Breakdown de totales en OPS */}
                        {o.amounts ? (
                          <div className="col-12">
                            <div className="d-flex flex-column align-items-end gap-1">
                              <div className="small text-muted">
                                {t(lang, "orders.subtotal")}: <span className="fw-semibold">
                                  {fmtQ(Number(o.amounts.subtotal || 0))}
                                </span>
                              </div>
                              {!!o.amounts.tax && (
                                <div className="small text-muted">
                                  {t(lang, "orders.taxes")}: <span className="fw-semibold">
                                    {fmtQ(Number(o.amounts.tax || 0))}
                                  </span>
                                </div>
                              )}
                              {!!o.amounts.serviceFee && (
                                <div className="small text-muted">
                                  {t(lang, "orders.service")}: <span className="fw-semibold">
                                    {fmtQ(Number(o.amounts.serviceFee || 0))}
                                  </span>
                                </div>
                              )}
                              {!!o.amounts.discount && (
                                <div className="small text-muted">
                                  {t(lang, "orders.discount")}: <span className="fw-semibold">
                                    −{fmtQ(Number(o.amounts.discount || 0))}
                                  </span>
                                </div>
                              )}
                              {!!o.amounts.tip && (
                                <div className="small text-muted">
                                  {t(lang, "orders.tip")}: <span className="fw-semibold">
                                    {fmtQ(Number(o.amounts.tip || 0))}
                                  </span>
                                </div>
                              )}
                              <div className="mt-1">
                                {t(lang, "orders.total")}: <span className="fw-bold">
                                  {fmtQ(Number(o.amounts.total || total))}
                                </span>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="col-12">
                            <div className="d-flex flex-column align-items-end gap-1">
                              <div className="small text-muted">
                                {t(lang, "orders.subtotal")}: <span className="fw-semibold">
                                  {fmtQ(Number(computed?.subtotal || 0))}
                                </span>
                              </div>
                              <div className="mt-1">
                                {t(lang, "orders.total")}: <span className="fw-bold">
                                  {fmtQ(Number(computed?.total || total))}
                                </span>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-4">
        <Link href="/menu" className="btn btn-outline-secondary">{t(lang, "orders.backToMenu")}</Link>
      </div>
    </div>
  );
}

/** --------------------------
 *  Protected export
 *  -------------------------- */
export default function ClientOrdersPage() {
  return (
    <Protected>
      <ClientOrdersPageInner />
    </Protected>
  );
}
