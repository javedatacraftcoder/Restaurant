// src/app/(client)/app/orders/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Protected from "@/components/Protected";
import { useAuth } from "@/app/providers";

/** --------------------------
 *  Tipos de datos esperados
 *  -------------------------- */
type FirestoreTS =
  | { seconds: number; nanoseconds?: number }
  | Date
  | null
  | undefined;

type OpsOption = { groupName: string; selected: Array<{ name: string; priceDelta: number }> };

// 🔧 NUEVO: shape usado por checkout (addons + optionGroups.items)
type OpsAddon = { name: string; price?: number };
type OpsGroupItem = { id: string; name: string; priceDelta?: number };
type OpsGroup = { groupId: string; groupName: string; type?: "single" | "multiple"; items: OpsGroupItem[] };

type OpsItem = {
  menuItemId: string;
  menuItemName?: string;
  quantity: number;
  // Compat: viejo
  options?: OpsOption[];
  // Nuevo (checkout)
  addons?: OpsAddon[];
  optionGroups?: OpsGroup[];
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

  // autoría
  createdBy?: { uid?: string; email?: string | null } | null;
  userEmail?: string | null;
  userEmail_lower?: string | null;
  contact?: { email?: string | null } | null;
};

type ApiList = { ok?: boolean; orders?: Order[]; error?: string };

/** --------------------------
 *  Helpers de formato/fecha
 *  -------------------------- */
function tsToDate(ts: any): Date | null {
  if (!ts) return null;

  // 1) Date ya listo
  if (ts instanceof Date) return isNaN(ts.getTime()) ? null : ts;

  // 2) Firestore Timestamp (cliente)
  if (typeof ts?.toDate === "function") {
    const d = ts.toDate();
    return d instanceof Date && !isNaN(d.getTime()) ? d : null;
  }

  // 3) Objeto serializado con segundos/nanosegundos (con o sin guion bajo)
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
    // 3b) ISO serializado dentro de otra propiedad común
    const iso = ts.$date ?? ts.iso ?? ts.date ?? null;
    if (typeof iso === "string") {
      const d = new Date(iso);
      if (!isNaN(d.getTime())) return d;
    }
  }

  // 4) String: ISO o número en string (ms/segundos)
  if (typeof ts === "string") {
    const d = new Date(ts);
    if (!isNaN(d.getTime())) return d;
    const n = Number(ts);
    if (Number.isFinite(n)) {
      const ms = n > 1e12 ? n : n * 1000; // heurística ms vs s
      const d2 = new Date(ms);
      if (!isNaN(d2.getTime())) return d2;
    }
    return null;
  }

  // 5) Número: epoch en ms o s
  if (typeof ts === "number") {
    const ms = ts > 1e12 ? ts : ts * 1000; // heurística ms vs s
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
  const c = (cur || "GTQ").toUpperCase();
  if (c === "GTQ") return "Q";
  if (c === "USD") return "$";
  return `${c} `;
}

function fmtMoneyQ(n: number, cur = "GTQ") {
  return `${currencySymbol(cur)}${n.toFixed(2)}`;
}

function orderTotal(order: Order): number {
  // OPS
  if (order.amounts && typeof order.amounts.total === "number") return Number(order.amounts.total || 0);
  // LEGACY
  const cents =
    (order.totals?.totalCents ?? null) != null
      ? Number(order.totals!.totalCents!)
      : Array.isArray(order.lines)
      ? order.lines.reduce((acc, l) => acc + (Number(l.totalCents || 0)), 0)
      : 0;
  return cents / 100;
}

function lineName(l: LegacyLine) {
  return (l.name && String(l.name)) || (l.itemId && `Item ${l.itemId}`) || "Ítem";
}

function closedStatus(s?: string) {
  const v = (s || "").toLowerCase();
  return v === "closed" || v === "cancelled" ? v : null;
}

/** --------------------------
 *  Página (inner)
 *  -------------------------- */
function ClientOrdersPageInner() {
  const { user, idToken } = useAuth();
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);

  // Cargar órdenes y filtrar por el usuario actual (uid/email).
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

        // Orden descendente por fecha
        mine.sort((a, b) => {
          const da = tsToDate(a.createdAt)?.getTime() ?? 0;
          const db = tsToDate(b.createdAt)?.getTime() ?? 0;
          return db - da;
        });

        if (alive) setOrders(mine);
      } catch (e: any) {
        if (alive) setErr(e?.message || "No se pudieron cargar las órdenes");
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
        <h1 className="h5 m-0">Mis órdenes</h1>
        <span className="text-muted small">Total: {totalOrders}</span>
      </div>

      {loading && <div className="alert alert-info">Cargando órdenes…</div>}
      {err && <div className="alert alert-danger">Error: {err}</div>}

      {!loading && !err && totalOrders === 0 && (
        <div className="alert alert-secondary">
          Aún no tienes órdenes. Ve al <Link href="/menu">menú</Link> para empezar.
        </div>
      )}

      {!loading && !err && totalOrders > 0 && (
        <div className="list-group">
          {orders.map((o) => {
            const total = orderTotal(o);
            const cur = (o.currency || "GTQ").toUpperCase();
            const isOpen = openId === o.id;
            const closed = !!closedStatus(o.status);
            const pillClass = closed ? "bg-danger" : "bg-primary";

            return (
              <div key={o.id} className="list-group-item p-0 border-0 mb-3">
                <div className="card shadow-sm">
                  <div className="card-body d-flex flex-column flex-md-row justify-content-between align-items-start align-items-md-center">
                    <div className="me-md-3">
                      <div className="d-flex align-items-center flex-wrap gap-2">
                        <span className="fw-semibold">Orden #{o.id.slice(0, 6)}</span>
                        <span className={`badge rounded-pill ${pillClass}`}>{(o.status || "placed").toUpperCase()}</span>
                      </div>
                      <div className="small text-muted mt-1">Fecha: {fmtDate(o.createdAt)}</div>
                    </div>
                    <div className="mt-2 mt-md-0 fw-bold">
                      {fmtMoneyQ(total, cur)}
                    </div>
                  </div>

                  {/* Acciones */}
                  <div className="card-footer d-flex gap-2">
                    <button
                      type="button"
                      className="btn btn-outline-secondary btn-sm"
                      onClick={() => setOpenId(isOpen ? null : o.id)}
                    >
                      {isOpen ? "Ocultar detalle" : "Ver detalle"}
                    </button>
                    <Link href={`/app/orders/${o.id}`} className="btn btn-outline-primary btn-sm">
                      Abrir / Compartir
                    </Link>
                  </div>

                  {/* Detalle expandible en línea */}
                  {isOpen && (
                    <div className="card-footer bg-white">
                      {/* OPS items */}
                      {Array.isArray(o.items) && o.items.length > 0 && (
                        <div className="mb-3">
                          <div className="fw-semibold mb-2">Productos</div>
                          <ul className="list-group">
                            {o.items.map((it, idx) => (
                              <li className="list-group-item" key={`${it.menuItemId}-${idx}`}>
                                <div className="d-flex justify-content-between">
                                  <div>
                                    <div className="fw-semibold">
                                      {it.menuItemName || it.menuItemId}
                                    </div>

                                    {/* ✅ Nuevo: addons */}
                                    {Array.isArray(it.addons) && it.addons.length > 0 && (
                                      <ul className="small text-muted mt-1 ps-3">
                                        {it.addons.map((ad, ai) => (
                                          <li key={ai}>
                                            (addon) {ad.name}
                                            {typeof ad.price === "number" ? ` — ${fmtMoneyQ(ad.price, o.currency)}` : ""}
                                          </li>
                                        ))}
                                      </ul>
                                    )}

                                    {/* ✅ Nuevo: optionGroups.items */}
                                    {Array.isArray(it.optionGroups) && it.optionGroups.some(g => (g.items || []).length > 0) && (
                                      <ul className="small text-muted mt-1 ps-3">
                                        {it.optionGroups.map((g, gi) => (
                                          (g.items || []).length > 0 ? (
                                            <li key={gi}>
                                              <span className="fw-semibold">{g.groupName}:</span>{" "}
                                              {(g.items || [])
                                                .map(og => `${og.name}${typeof og.priceDelta === "number" ? ` (${fmtMoneyQ(og.priceDelta, o.currency)})` : ""}`)
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
                                              .map((s) => `${s.name}${typeof s.priceDelta === "number" ? ` (${fmtMoneyQ(s.priceDelta, o.currency)})` : ""}`)
                                              .join(", ")}
                                          </li>
                                        ))}
                                      </ul>
                                    )}

                                    {/* Si nada de lo anterior aplica */}
                                    {!((it.addons && it.addons.length) ||
                                       (it.optionGroups && it.optionGroups.some(g => (g.items || []).length > 0)) ||
                                       (it.options && it.options.length)) && (
                                      <div className="small text-muted">Sin addons</div>
                                    )}
                                  </div>

                                  <div className="ms-3 text-nowrap">x{it.quantity}</div>
                                </div>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {/* LEGACY lines */}
                      {Array.isArray(o.lines) && o.lines.length > 0 && (
                        <div className="mb-3">
                          <div className="fw-semibold mb-2">Productos</div>
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

                      {/* Notas y totales */}
                      <div className="row g-2">
                        {o.notes ? (
                          <div className="col-12">
                            <div className="small">
                              <span className="text-muted">Notas: </span>
                              {o.notes}
                            </div>
                          </div>
                        ) : null}

                        {/* Totales desglosados si vienen en OPS */}
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
                                  Impuestos: <span className="fw-semibold">
                                    {fmtMoneyQ(Number(o.amounts.tax || 0), o.currency)}
                                  </span>
                                </div>
                              )}
                              {!!o.amounts.serviceFee && (
                                <div className="small text-muted">
                                  Servicio: <span className="fw-semibold">
                                    {fmtMoneyQ(Number(o.amounts.serviceFee || 0), o.currency)}
                                  </span>
                                </div>
                              )}
                              {!!o.amounts.discount && (
                                <div className="small text-muted">
                                  Descuento: <span className="fw-semibold">
                                    −{fmtMoneyQ(Number(o.amounts.discount || 0), o.currency)}
                                  </span>
                                </div>
                              )}
                              {!!o.amounts.tip && (
                                <div className="small text-muted">
                                  Propina: <span className="fw-semibold">
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
                          <div className="col-12 d-flex justify-content-end">
                            <div>
                              Total: <span className="fw-bold">{fmtMoneyQ(total, o.currency)}</span>
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
        <Link href="/menu" className="btn btn-outline-secondary">Volver al menú</Link>
      </div>
    </div>
  );
}

/** --------------------------
 *  Export protegido
 *  -------------------------- */
export default function ClientOrdersPage() {
  return (
    <Protected>
      <ClientOrdersPageInner />
    </Protected>
  );
}
