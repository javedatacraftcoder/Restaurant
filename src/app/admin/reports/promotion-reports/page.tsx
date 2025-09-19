// src/app/admin/promotion-reports/page.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import Protected from "@/components/Protected";
import AdminOnly from "@/components/AdminOnly";
import "@/lib/firebase/client";
import {
  getFirestore,
  collection,
  query,
  where,
  orderBy,
  getDocs,
  Timestamp,
  DocumentData,
} from "firebase/firestore";

/** ========= Types ========= */
type AppliedPromotion = {
  promoId?: string;
  code?: string;
  discountTotalCents?: number;
  discountTotal?: number;
};

type OrderDoc = {
  id: string;
  createdAt?: Timestamp | { seconds: number } | Date | null;
  appliedPromotions?: AppliedPromotion[] | null;
  promotionCode?: string | null;

  totals?: { grandTotalWithTax?: number } | null;
  totalsCents?: { grandTotalWithTaxCents?: number } | null;
  payment?: { amount?: number } | null;
  orderTotal?: number | null;

  userEmail?: string | null;
  userEmail_lower?: string | null;
  createdBy?: { uid?: string | null; email?: string | null } | null;
};

type PieRow = { label: string; value: number; color?: string };

/** ========= Utils ========= */
function toDate(v: any): Date | null {
  if (!v) return null;
  if (v instanceof Date) return v;
  if (v?.seconds != null) return new Date(v.seconds * 1000);
  const d = new Date(v);
  return isNaN(d as any) ? null : d;
}
function money(n: number | undefined): string {
  const v = Number.isFinite(Number(n)) ? Number(n) : 0;
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(v);
  } catch {
    return `$${v.toFixed(2)}`;
  }
}
function getOrderRevenueUSD(o: OrderDoc): number {
  const cents = o.totalsCents?.grandTotalWithTaxCents;
  if (Number.isFinite(cents)) return (cents as number) / 100;
  const withTax = o.totals?.grandTotalWithTax;
  if (Number.isFinite(withTax)) return withTax as number;
  const pay = o.payment?.amount;
  if (Number.isFinite(pay)) return pay as number;
  const legacy = o.orderTotal;
  if (Number.isFinite(legacy ?? NaN)) return Number(legacy);
  return 0;
}

/** ========= Simple Pie (SVG, no deps) ========= */
function hsl(i: number, total: number) {
  const hue = Math.round((360 * i) / Math.max(1, total));
  return `hsl(${hue} 70% 55%)`;
}
function polarToCartesian(cx: number, cy: number, r: number, angle: number) {
  const rad = ((angle - 90) * Math.PI) / 180.0;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}
function arcPath(cx: number, cy: number, r: number, startAngle: number, endAngle: number) {
  const start = polarToCartesian(cx, cy, r, endAngle);
  const end = polarToCartesian(cx, cy, r, startAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? "0" : "1";
  return `M ${cx} ${cy} L ${start.x} ${start.y} A ${r} ${r} 0 ${largeArcFlag} 0 ${end.x} ${end.y} Z`;
}
function PieChart({
  rows,
  size = 220,
  title,
}: {
  rows: PieRow[];
  size?: number;
  title: string;
}) {
  const total = rows.reduce((s, r) => s + (Number(r.value) || 0), 0);
  const cx = size / 2, cy = size / 2, r = size / 2 - 4;
  let angle = 0;
  const slices = rows.map((row, i) => {
    const pct = total > 0 ? row.value / total : 0;
    const start = angle;
    const end = angle + pct * 360;
    angle = end;
    return {
      key: row.label + i,
      d: arcPath(cx, cy, r, start, end),
      fill: row.color || hsl(i, rows.length + 2),
      pct,
      label: row.label,
      value: row.value,
    };
  });

  return (
    <div className="card border-0 shadow-sm h-100">
      <div className="card-header fw-semibold d-flex justify-content-between align-items-center">
        <span>{title}</span>
        <span className="small text-muted">{total === 0 ? "No data" : `${rows.length} segments`}</span>
      </div>
      <div className="card-body">
        {total === 0 ? (
          <div className="text-muted small">No data</div>
        ) : (
          <div className="d-flex flex-column flex-md-row align-items-center gap-3">
            <div style={{ width: "100%", maxWidth: size }}>
              <svg viewBox={`0 0 ${size} ${size}`} style={{ width: "100%", height: "auto" }}>
                {slices.map((s) => (
                  <path key={s.key} d={s.d} fill={s.fill} stroke="white" strokeWidth="1" />
                ))}
              </svg>
            </div>
            <div className="flex-grow-1 w-100">
              <div className="d-flex flex-column gap-2">
                {slices.map((s) => (
                  <div
                    key={s.key}
                    className="d-flex align-items-center justify-content-between border rounded px-2 py-1"
                  >
                    <div className="d-flex align-items-center gap-2">
                      <span className="rounded-circle" style={{ display: "inline-block", width: 12, height: 12, background: s.fill }} />
                      <span className="small">{s.label}</span>
                    </div>
                    <div className="small text-muted">
                      {s.value} · {(s.pct * 100).toFixed(1)}%
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** ========= Excel (SpreadsheetML 2003) ========= */
type Sheet = { name: string; headers: string[]; rows: (string | number)[][] };
function xmlEscape(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function buildExcelXml(sheets: Sheet[]) {
  const ns =
    'xmlns="urn:schemas-microsoft-com:office:spreadsheet" ' +
    'xmlns:o="urn:schemas-microsoft-com:office:office" ' +
    'xmlns:x="urn:schemas-microsoft-com:office:excel" ' +
    'xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet" ' +
    'xmlns:html="http://www.w3.org/TR/REC-html40"';
  const header = `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook ${ns}>
<Styles>
  <Style ss:ID="sHeader"><Font ss:Bold="1"/><Interior ss:Color="#F2F2F2" ss:Pattern="Solid"/></Style>
  <Style ss:ID="sMoney"><NumberFormat ss:Format="Currency"/></Style>
  <Style ss:ID="sNumber"><NumberFormat ss:Format="General Number"/></Style>
</Styles>`;
  const sheetsXml = sheets.map((sheet) => {
    const cols = sheet.headers.map(() => `<Column ss:AutoFitWidth="1" ss:Width="160"/>`).join("");
    const headRow =
      `<Row>` +
      sheet.headers.map((h) => `<Cell ss:StyleID="sHeader"><Data ss:Type="String">${xmlEscape(h)}</Data></Cell>`).join("") +
      `</Row>`;
    const bodyRows = sheet.rows
      .map((r) => {
        const cells = r
          .map((v) =>
            typeof v === "number" && Number.isFinite(v)
              ? `<Cell ss:StyleID="${Number.isInteger(v) ? "sNumber" : "sMoney"}"><Data ss:Type="Number">${v}</Data></Cell>`
              : `<Cell><Data ss:Type="String">${xmlEscape(String(v))}</Data></Cell>`
          )
          .join("");
        return `<Row>${cells}</Row>`;
      })
      .join("\n");
    return `<Worksheet ss:Name="${xmlEscape(sheet.name)}"><Table>${cols}${headRow}${bodyRows}</Table></Worksheet>`;
  }).join("\n");
  return header + sheetsXml + `</Workbook>`;
}
function downloadExcelXml(filename: string, xml: string) {
  const blob = new Blob([xml], { type: "application/vnd.ms-excel" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".xls") ? filename : `${filename}.xls`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 0);
}

/** ========= Page ========= */
export default function AdminPromotionReportsPage() {
  const db = getFirestore();

  // Filters
  const [preset, setPreset] = useState<"today" | "7d" | "30d" | "thisMonth" | "custom">("30d");
  const [fromStr, setFromStr] = useState<string>("");
  const [toStr, setToStr] = useState<string>("");

  useEffect(() => {
    const today = new Date();
    const to = new Date(today); to.setHours(23,59,59,999);
    const from = new Date(); from.setDate(from.getDate()-29); from.setHours(0,0,0,0);
    setFromStr(from.toISOString().slice(0,10));
    setToStr(to.toISOString().slice(0,10));
  }, []);
  useEffect(() => {
    if (preset === "custom") return;
    const now = new Date();
    if (preset === "today") {
      const f = new Date(now); f.setHours(0,0,0,0);
      const t = new Date(now); t.setHours(23,59,59,999);
      setFromStr(f.toISOString().slice(0,10)); setToStr(t.toISOString().slice(0,10)); return;
    }
    if (preset === "7d") {
      const f = new Date(); f.setDate(f.getDate()-6); f.setHours(0,0,0,0);
      const t = new Date(now); t.setHours(23,59,59,999);
      setFromStr(f.toISOString().slice(0,10)); setToStr(t.toISOString().slice(0,10)); return;
    }
    if (preset === "30d") {
      const f = new Date(); f.setDate(f.getDate()-29); f.setHours(0,0,0,0);
      const t = new Date(now); t.setHours(23,59,59,999);
      setFromStr(f.toISOString().slice(0,10)); setToStr(t.toISOString().slice(0,10)); return;
    }
    if (preset === "thisMonth") {
      const f = new Date(now.getFullYear(), now.getMonth(), 1);
      const t = new Date(now.getFullYear(), now.getMonth()+1, 0);
      setFromStr(f.toISOString().slice(0,10)); setToStr(t.toISOString().slice(0,10)); return;
    }
  }, [preset]);

  // Data
  const [loading, setLoading] = useState(false);
  const [orders, setOrders] = useState<OrderDoc[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setError(null); setLoading(true);
    try {
      const from = new Date(fromStr + "T00:00:00");
      const to = new Date(toStr + "T23:59:59.999");

      const qRef = query(
        collection(db, "orders"),
        where("createdAt", ">=", Timestamp.fromDate(from)),
        where("createdAt", "<=", Timestamp.fromDate(to)),
        orderBy("createdAt", "asc"),
      );
      const snap = await getDocs(qRef);

      const arr: OrderDoc[] = snap.docs.map((d) => {
        const raw = d.data() as DocumentData;
        const promosRaw = Array.isArray(raw.appliedPromotions) ? raw.appliedPromotions : [];
        const normalizedPromos: AppliedPromotion[] = promosRaw.map((p: any) => ({
          promoId: p?.promoId ?? p?.id ?? undefined,
          code: p?.code ?? raw?.promotionCode ?? undefined,
          discountTotalCents: Number.isFinite(p?.discountTotalCents) ? Number(p.discountTotalCents) : undefined,
          discountTotal: Number.isFinite(p?.discountTotal) ? Number(p.discountTotal) : undefined,
        }));

        return {
          id: d.id,
          createdAt: raw.createdAt ?? null,
          appliedPromotions: normalizedPromos,
          promotionCode: raw.promotionCode ?? null,

          totals: raw.totals ?? null,
          totalsCents: raw.totalsCents ?? null,
          payment: raw.payment ?? null,
          orderTotal: Number.isFinite(raw.orderTotal) ? Number(raw.orderTotal) : null,

          userEmail: raw.userEmail ?? null,
          userEmail_lower: raw.userEmail_lower ?? null,
          createdBy: raw.createdBy ?? null,
        };
      });
      setOrders(arr);
    } catch (e: any) {
      setError(e?.message || "Failed to load data.");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { if (fromStr && toStr) load(); /* eslint-disable-next-line */ }, [fromStr, toStr]);

  /** ========= Aggregations ========= */
  const totalOrders = orders.length;
  const totalRevenue = useMemo(() => orders.reduce((s, o) => s + getOrderRevenueUSD(o), 0), [orders]);

  // Split orders: with promo vs without
  const withPromoOrders = useMemo(
    () => orders.filter(o => (o.appliedPromotions && o.appliedPromotions.length > 0) || (o.promotionCode && String(o.promotionCode).trim() !== "")),
    [orders]
  );
  const withoutPromoOrders = useMemo(
    () => orders.filter(o => !withPromoOrders.includes(o)),
    [orders, withPromoOrders]
  );

  const avgTicketWithPromo = useMemo(
    () => withPromoOrders.length ? withPromoOrders.reduce((s, o) => s + getOrderRevenueUSD(o), 0) / withPromoOrders.length : 0,
    [withPromoOrders]
  );
  const avgTicketWithoutPromo = useMemo(
    () => withoutPromoOrders.length ? withoutPromoOrders.reduce((s, o) => s + getOrderRevenueUSD(o), 0) / withoutPromoOrders.length : 0,
    [withoutPromoOrders]
  );

  // Pie: Orders with vs without promo
  const pieWithVsWithout: PieRow[] = useMemo(() => [
    { label: "With promo", value: withPromoOrders.length },
    { label: "Without promo", value: withoutPromoOrders.length },
  ], [withPromoOrders, withoutPromoOrders]);

  // Usage by coupon (code)
  type CouponAgg = { code: string; uses: number; savedUSD: number; share: number };
  const couponsAgg: CouponAgg[] = useMemo(() => {
    const map = new Map<string, { uses: number; savedUSD: number }>();
    const sumDiscount = (p: AppliedPromotion | undefined | null): number => {
      if (!p) return 0;
      if (Number.isFinite(p.discountTotalCents)) return Number(p.discountTotalCents) / 100;
      if (Number.isFinite(p.discountTotal)) return Number(p.discountTotal);
      return 0;
    };

    for (const o of orders) {
      // prefer appliedPromotions snapshot (pueden venir múltiples por orden)
      if (o.appliedPromotions && o.appliedPromotions.length > 0) {
        // Dedupe por code por si llega duplicado en snapshot
        const byCode = new Map<string, number>();
        for (const p of o.appliedPromotions) {
          const code = (p.code || o.promotionCode || "").toString().toUpperCase();
          if (!code) continue;
          const add = sumDiscount(p);
          byCode.set(code, (byCode.get(code) || 0) + add);
        }
        for (const [code, saved] of byCode.entries()) {
          const prev = map.get(code) || { uses: 0, savedUSD: 0 };
          prev.uses += 1;            // cuenta la orden como 1 “uso” por code
          prev.savedUSD += saved;    // ahorro total registrado por snapshot
          map.set(code, prev);
        }
      } else {
        // fallback: solo promotionCode (sin snapshot detallado)
        const code = (o.promotionCode || "").toString().toUpperCase();
        if (code) {
          const prev = map.get(code) || { uses: 0, savedUSD: 0 };
          prev.uses += 1;
          // si no hay descuento detallado, no sumamos “saved”
          map.set(code, prev);
        }
      }
    }
    const arr = Array.from(map.entries()).map(([code, v]) => ({
      code,
      uses: v.uses,
      savedUSD: Number(v.savedUSD.toFixed(2)),
      share: totalOrders > 0 ? v.uses / totalOrders : 0,
    }));
    // ordenar por usos desc
    return arr.sort((a, b) => b.uses - a.uses);
  }, [orders, totalOrders]);

  // Pie: top coupons by uses (cap 8 segmentos)
  const pieCoupons: PieRow[] = useMemo(() => {
    const top = couponsAgg.slice(0, 8);
    return top.map(c => ({ label: c.code, value: c.uses }));
  }, [couponsAgg]);

  // "Más efectiva" = mayor conversión (share de órdenes del rango con ese cupón)
  const mostEffective = couponsAgg.length > 0
    ? [...couponsAgg].sort((a, b) => b.share - a.share)[0]
    : null;

  /** ========= Export ========= */
  function onExportExcel() {
    const summary: Sheet = {
      name: "PromoVsNoPromo",
      headers: ["Metric", "Value"],
      rows: [
        ["Orders (total)", totalOrders],
        ["Orders with promo", withPromoOrders.length],
        ["Orders without promo", withoutPromoOrders.length],
        ["Avg ticket (with promo)", Number(avgTicketWithPromo.toFixed(2))],
        ["Avg ticket (without promo)", Number(avgTicketWithoutPromo.toFixed(2))],
      ],
    };
    const couponsSheet: Sheet = {
      name: "CouponsUsage",
      headers: ["Code", "Uses (orders)", "Saved (USD)", "Conversion share (%)"],
      rows: couponsAgg.map(c => [c.code, c.uses, Number(c.savedUSD.toFixed(2)), Number((c.share * 100).toFixed(2))]),
    };
    const topConv: Sheet = {
      name: "TopPromosByConversion",
      headers: ["Code", "Conversion share (%)", "Uses (orders)", "Saved (USD)"],
      rows: [...couponsAgg]
        .sort((a,b)=> b.share - a.share)
        .map(c => [c.code, Number((c.share * 100).toFixed(2)), c.uses, Number(c.savedUSD.toFixed(2))]),
    };
    const withSheet: Sheet = {
      name: "OrdersWithPromo",
      headers: ["OrderId", "CreatedAt (UTC)", "Revenue (USD)", "Codes"],
      rows: withPromoOrders.map(o => [
        o.id,
        toDate(o.createdAt)?.toISOString().replace("T"," ").slice(0,19) || "",
        Number(getOrderRevenueUSD(o).toFixed(2)),
        Array.from(new Set([
          ...(o.appliedPromotions?.map(p => (p.code || o.promotionCode || "").toString().toUpperCase()) || []),
          (o.promotionCode || "").toString().toUpperCase(),
        ].filter(Boolean))).join(", "),
      ]),
    };
    const withoutSheet: Sheet = {
      name: "OrdersWithoutPromo",
      headers: ["OrderId", "CreatedAt (UTC)", "Revenue (USD)"],
      rows: withoutPromoOrders.map(o => [
        o.id,
        toDate(o.createdAt)?.toISOString().replace("T"," ").slice(0,19) || "",
        Number(getOrderRevenueUSD(o).toFixed(2)),
      ]),
    };

    const xml = buildExcelXml([summary, couponsSheet, topConv, withSheet, withoutSheet]);
    downloadExcelXml(`promotion_report_${fromStr}_to_${toStr}.xls`, xml);
  }

  return (
    <Protected>
      <AdminOnly>
        <main className="container py-4">
          <h1 className="h4 mb-3">Promotion & Marketing Reports</h1>

          {/* Filters */}
          <div className="card border-0 shadow-sm mb-3">
            <div className="card-body">
              <div className="row g-3">
                <div className="col-12 col-md-3">
                  <label className="form-label fw-semibold">Range</label>
                  <select className="form-select" value={preset} onChange={(e) => setPreset(e.target.value as any)}>
                    <option value="today">Today</option>
                    <option value="7d">Last 7 days</option>
                    <option value="30d">Last 30 days</option>
                    <option value="thisMonth">This month</option>
                    <option value="custom">Custom</option>
                  </select>
                </div>
                <div className="col-6 col-md-3">
                  <label className="form-label fw-semibold">From</label>
                  <input type="date" className="form-control" value={fromStr} onChange={(e) => { setFromStr(e.target.value); setPreset("custom"); }} />
                </div>
                <div className="col-6 col-md-3">
                  <label className="form-label fw-semibold">To</label>
                  <input type="date" className="form-control" value={toStr} onChange={(e) => { setToStr(e.target.value); setPreset("custom"); }} />
                </div>
                <div className="col-12 col-md-3 d-flex align-items-end">
                  <div className="d-flex gap-2 w-100">
                    <button className="btn btn-primary flex-fill" onClick={load} disabled={loading}>
                      {loading ? "Loading…" : "Refresh"}
                    </button>
                    <button
                      className="btn btn-outline-success"
                      onClick={onExportExcel}
                      disabled={loading || orders.length === 0}
                    >
                      Export to Excel
                    </button>
                  </div>
                </div>
              </div>
              {error && <div className="text-danger small mt-2">{error}</div>}
              <div className="text-muted small mt-2">
               {/* Totals computed like checkout (grand total with tax → payment.amount → orderTotal). Coupons read from <code>appliedPromotions[]</code> and <code>promotionCode</code>. If in the future you track “attempts”/“impressions”, we’ll refine the conversion metric. :contentReference[oaicite:1]{index=1}*/}
              </div>
            </div>
          </div>

          {/* KPIs */}
          <div className="row g-3 mb-3">
            <div className="col-6 col-md-3">
              <div className="card border-0 shadow-sm"><div className="card-body">
                <div className="text-muted small">Orders</div>
                <div className="h4 mb-0">{totalOrders}</div>
              </div></div>
            </div>
            <div className="col-6 col-md-3">
              <div className="card border-0 shadow-sm"><div className="card-body">
                <div className="text-muted small">Revenue</div>
                <div className="h4 mb-0">{money(totalRevenue)}</div>
              </div></div>
            </div>
            <div className="col-6 col-md-3">
              <div className="card border-0 shadow-sm"><div className="card-body">
                <div className="text-muted small">Avg ticket (with promo)</div>
                <div className="h5 mb-0">{money(avgTicketWithPromo)}</div>
              </div></div>
            </div>
            <div className="col-6 col-md-3">
              <div className="card border-0 shadow-sm"><div className="card-body">
                <div className="text-muted small">Avg ticket (without promo)</div>
                <div className="h5 mb-0">{money(avgTicketWithoutPromo)}</div>
              </div></div>
            </div>
          </div>

          {/* Tables */}
          <div className="row g-3">
            <div className="col-12 col-lg-6">
              <div className="card border-0 shadow-sm h-100">
                <div className="card-header fw-semibold">Coupon usage (count & savings)</div>
                <div className="card-body p-0">
                  <div className="table-responsive">
                    <table className="table mb-0">
                      <thead>
                        <tr>
                          <th>Code</th>
                          <th className="text-end">Uses (orders)</th>
                          <th className="text-end">Saved (USD)</th>
                          <th className="text-end">Conversion share</th>
                        </tr>
                      </thead>
                      <tbody>
                        {couponsAgg.length === 0 && <tr><td colSpan={4} className="text-center text-muted">No data</td></tr>}
                        {couponsAgg.map(c => (
                          <tr key={c.code}>
                            <td>{c.code}</td>
                            <td className="text-end">{c.uses}</td>
                            <td className="text-end">{money(c.savedUSD)}</td>
                            <td className="text-end">{(c.share * 100).toFixed(1)}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
                {mostEffective && (
                  <div className="card-footer small">
                    Most effective: <strong>{mostEffective.code}</strong> ({(mostEffective.share*100).toFixed(1)}% of orders in range).
                  </div>
                )}
              </div>
            </div>

            <div className="col-12 col-lg-6">
              <div className="card border-0 shadow-sm h-100">
                <div className="card-header fw-semibold">Orders — With vs Without promotions</div>
                <div className="card-body p-0">
                  <div className="table-responsive">
                    <table className="table mb-0">
                      <thead>
                        <tr>
                          <th>Group</th>
                          <th className="text-end">Orders</th>
                          <th className="text-end">Avg ticket</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td>With promo</td>
                          <td className="text-end">{withPromoOrders.length}</td>
                          <td className="text-end">{money(avgTicketWithPromo)}</td>
                        </tr>
                        <tr>
                          <td>Without promo</td>
                          <td className="text-end">{withoutPromoOrders.length}</td>
                          <td className="text-end">{money(avgTicketWithoutPromo)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
                <div className="card-footer small text-muted">
                  Avg ticket computed from placed orders only. Conversion = share of orders using the code inside the selected range.
                </div>
              </div>
            </div>
          </div>

          {/* Pies */}
          <div className="row g-3 mt-3">
            <div className="col-12 col-lg-6">
              <PieChart rows={pieWithVsWithout} title="Orders with vs without promo (Pie)" />
            </div>
            <div className="col-12 col-lg-6">
              <PieChart rows={pieCoupons} title="Top coupons by uses (Pie)" />
            </div>
          </div>
        </main>
      </AdminOnly>
    </Protected>
  );
}
