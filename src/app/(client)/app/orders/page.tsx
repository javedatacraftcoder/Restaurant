"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Protected from "@/components/Protected";
import { useAuth } from "@/app/providers";

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

  // 1) Dia
  if (ts instanceof Date) return isNaN(ts.getTime()) ? null : ts;

  // 2) Tiempos en Firestoe(cliente)
  if (typeof ts?.toDate === "function") {
    const d = ts.toDate();
    return d instanceof Date && !isNaN(d.getTime()) ? d : null;
  }

  // 3) Objeto serializado con segundos y nano segundos (con o sin guionbajo)
  if (typeof ts === "object") {
    const seconds =
      ts.seconds ?? ts._seconds ?? ts.$seconds ?? null;
    const nanos =
      ts.nanoseconds ?? ts._nanoseconds ?? ts.nanos ?? 0;
    if (seconds != null) {
      const ms = seconds * 1000 + Math.floor((nanos || 0) / 1e6);
      const d = new Date(ms);
      if (!isNaN(d.getTime())) return d;
    }
    // 3b) ISO serializado dentro de otro prop
    const iso = ts.$date ?? ts.iso ?? ts.date ?? null;
    if (typeof iso === "string") {
      const d = new Date(iso);
      if (!isNaN(d.getTime())) return d;
    }
  }

  // 4) String: ISO o string numerico (ms/seconds)
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

  // 5) Numero ms o s
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

function currencySymbol(cur?: string) {
  const c = (cur || "USD").toUpperCase();
  if (c === "GTQ") return "Q";
  if (c === "USD") return "$";
  return `${c} `;
}

function fmtMoneyQ(n: number, cur = "USD") {
  return `${currencySymbol(cur)}${n.toFixed(2)}`;
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
  // intenta todas las variantes conocidas
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

  // Derivar desde totalCents si viene y hay qty
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
  // Sin conocer tax/discount/service exactos, mostramos al menos subtotal + tip
  const total = Number.isFinite(Number(o.amounts?.total))
    ? Number(o.amounts!.total)
    : subtotal + tip;
  return { subtotal, total };
}

function orderTotal(order: Order): number {
  // OPS (servido por backend)
  if (order.amounts && typeof order.amounts.total === "number") return Number(order.amounts.total || 0);

  // LEGACY
  const cents =
    (order.totals?.totalCents ?? null) != null
      ? Number(order.totals!.totalCents!)
      : Array.isArray(order.lines)
      ? order.lines.reduce((acc, l) => acc + (Number(l.totalCents || 0)), 0)
      : 0;
  const legacy = cents / 100;

  // Si no hay legacy ni amounts, calcular desde items
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

/** --------------------------
 *  Page (inner)
 *  -------------------------- */
function ClientOrdersPageInner() {
  const { user, idToken } = useAuth();
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);

  // Carga usuarios y filtra (uid/email).
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

        // Desciende por fecha
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
        <h1 className="h5 m-0">My orders</h1>
        <span className="text-muted small">Total: {totalOrders}</span>
      </div>

      {loading && <div className="alert alert-info">Loading orders…</div>}
      {err && <div className="alert alert-danger">Error: {err}</div>}

      {!loading && !err && totalOrders === 0 && (
        <div className="alert alert-secondary">
          You don't have any orders yet. Go to the <Link href="/menu">menu</Link> to get started.
        </div>
      )}

      {!loading && !err && totalOrders > 0 && (
        <div className="list-group">
          {orders.map((o) => {
            const total = orderTotal(o);
            const cur = (o.currency || "USD").toUpperCase();
            const isOpen = openId === o.id;
            const closed = !!closedStatus(o.status);
            const pillClass = closed ? "bg-danger" : "bg-primary";

            // ✅ Si no hay amounts, calculamos subtotal desde items para el desglose
            const computed = !o.amounts && Array.isArray(o.items) && o.items.length
              ? computeFromItems(o)
              : null;

            return (
              <div key={o.id} className="list-group-item p-0 border-0 mb-3">
                <div className="card shadow-sm">
                  <div className="card-body d-flex flex-column flex-md-row justify-content-between align-items-start align-items-md-center">
                    <div className="me-md-3">
                      <div className="d-flex align-items-center flex-wrap gap-2">
                        <span className="fw-semibold">Order #{o.id.slice(0, 6)}</span>
                        <span className={`badge rounded-pill ${pillClass}`}>{(o.status || "placed").toUpperCase()}</span>
                      </div>
                      <div className="small text-muted mt-1">Date: {fmtDate(o.createdAt)}</div>

                      {/* ✅ Invoice info, si existe */}
                      {(o.invoiceNumber || o.invoiceDate) && (
                        <div className="small text-muted">
                          Invoice: {o.invoiceNumber || "-"}{o.invoiceDate ? ` • ${fmtDate(o.invoiceDate)}` : ""}
                        </div>
                      )}
                    </div>
                    <div className="mt-2 mt-md-0 fw-bold">
                      {fmtMoneyQ(total, cur)}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="card-footer d-flex gap-2">
                    <button
                      type="button"
                      className="btn btn-outline-secondary btn-sm"
                      onClick={() => setOpenId(isOpen ? null : o.id)}
                    >
                      {isOpen ? "Hide details" : "View details"}
                    </button>
                    <Link href={`/app/orders/${o.id}`} className="btn btn-outline-primary btn-sm">
                      Open / Share
                    </Link>
                  </div>

                  {/* Detalle inline expandible */}
                  {isOpen && (
                    <div className="card-footer bg-white">
                      {/* OPS items */}
                      {Array.isArray(o.items) && o.items.length > 0 && (
                        <div className="mb-3">
                          <div className="fw-semibold mb-2">Products</div>
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

                                      {/* addons (price o priceCents) */}
                                      {Array.isArray(it.addons) && it.addons.length > 0 && (
                                        <ul className="small text-muted mt-1 ps-3">
                                          {it.addons.map((ad, ai) => {
                                            const q = priceQ(ad);
                                            return (
                                              <li key={ai}>
                                                (addon) {ad.name}{q ? ` — ${fmtMoneyQ(q, o.currency)}` : ""}
                                              </li>
                                            );
                                          })}
                                        </ul>
                                      )}

                                      {/* ✅ New: optionGroups.items (priceDelta o priceDeltaCents) */}
                                      {Array.isArray(it.optionGroups) && it.optionGroups.some(g => (g.items || []).length > 0) && (
                                        <ul className="small text-muted mt-1 ps-3">
                                          {it.optionGroups.map((g, gi) => {
                                            const list = (g.items || []);
                                            if (!list.length) return null;
                                            const rows = list.map((og, i) => {
                                              const d = priceDeltaQ(og);
                                              return `${og.name}${d ? ` (${fmtMoneyQ(d, o.currency)})` : ""}`;
                                            }).join(", ");
                                            return (
                                              <li key={gi}>
                                                <span className="fw-semibold">{g.groupName}:</span> {rows}
                                              </li>
                                            );
                                          })}
                                        </ul>
                                      )}

                                      {Array.isArray(it.options) && it.options.length > 0 && (
                                        <ul className="small text-muted mt-1 ps-3">
                                          {it.options.map((g, gi) => {
                                            const rows = (g.selected || []).map((s) => {
                                              const d = priceDeltaQ(s);
                                              return `${s.name}${d ? ` (${fmtMoneyQ(d, o.currency)})` : ""}`;
                                            }).join(", ");
                                            return (
                                              <li key={gi}>
                                                <span className="fw-semibold">{g.groupName}:</span> {rows}
                                              </li>
                                            );
                                          })}
                                        </ul>
                                      )}

                                      {/* If none of the above applies */}
                                      {!((it.addons && it.addons.length) ||
                                         (it.optionGroups && it.optionGroups.some(g => (g.items || []).length > 0)) ||
                                         (it.options && it.options.length)) && (
                                        <div className="small text-muted">No addons</div>
                                      )}
                                    </div>

                                    {/* ✅ Monto por línea */}
                                    <div className="ms-3 text-nowrap">
                                      {fmtMoneyQ(lineTotal, o.currency)}
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
                          <div className="fw-semibold mb-2">Products</div>
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
                                      {fmtMoneyQ(totalQ, o.currency)}
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
                              <span className="text-muted">Notes: </span>
                              {o.notes}
                            </div>
                          </div>
                        ) : null}

                        {/* Breakdown de totales en OPS */}
                        {o.amounts ? (
                          <div className="col-12">
                            <div className="d-flex flex-column align-items-end gap-1">
                              <div className="small text-muted">
                                Subtotal: <span className="fw-semibold">
                                  {fmtMoneyQ(Number(o.amounts.subtotal || 0), o.currency)}
                                </span>
                              </div>
                              {!!o.amounts.tax && (
                                <div className="small text-muted">
                                  Taxes: <span className="fw-semibold">
                                    {fmtMoneyQ(Number(o.amounts.tax || 0), o.currency)}
                                  </span>
                                </div>
                              )}
                              {!!o.amounts.serviceFee && (
                                <div className="small text-muted">
                                  Service: <span className="fw-semibold">
                                    {fmtMoneyQ(Number(o.amounts.serviceFee || 0), o.currency)}
                                  </span>
                                </div>
                              )}
                              {!!o.amounts.discount && (
                                <div className="small text-muted">
                                  Discount: <span className="fw-semibold">
                                    −{fmtMoneyQ(Number(o.amounts.discount || 0), o.currency)}
                                  </span>
                                </div>
                              )}
                              {!!o.amounts.tip && (
                                <div className="small text-muted">
                                  Tip: <span className="fw-semibold">
                                    {fmtMoneyQ(Number(o.amounts.tip || 0), o.currency)}
                                  </span>
                                </div>
                              )}
                              <div className="mt-1">
                                Total: <span className="fw-bold">
                                  {fmtMoneyQ(Number(o.amounts.total || total), o.currency)}
                                </span>
                              </div>
                            </div>
                          </div>
                        ) : (
                          // ✅ Si no hay amounts, mostramos lo calculado desde items
                          <div className="col-12">
                            <div className="d-flex flex-column align-items-end gap-1">
                              <div className="small text-muted">
                                Subtotal: <span className="fw-semibold">
                                  {fmtMoneyQ(Number(computed?.subtotal || 0), o.currency)}
                                </span>
                              </div>
                              <div className="mt-1">
                                Total: <span className="fw-bold">
                                  {fmtMoneyQ(Number(computed?.total || total), o.currency)}
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
        <Link href="/menu" className="btn btn-outline-secondary">Back to menu</Link>
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
