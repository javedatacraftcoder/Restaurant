// src/app/admin/sales-report/page.tsx
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
} from "firebase/firestore";
import { useFmtQ } from "@/lib/settings/money";

/** ===== Types (minimal) ===== */
type OrderDoc = {
  id: string;
  createdAt?: Timestamp | { seconds: number; nanoseconds?: number } | Date | null;
  orderInfo?: { type?: "dine-in" | "delivery" | "pickup" | string } | null;
  orderTotal?: number;
  payment?: { amount?: number; status?: string; provider?: string; currency?: string | null } | null;
  totals?: { grandTotalWithTax?: number } | null;
  totalsCents?: { grandTotalWithTaxCents?: number } | null;
};

type Period = "day" | "week" | "month";

function toDate(v: any): Date | null {
  if (!v) return null;
  if (v instanceof Date) return v;
  if (v?.seconds != null) return new Date(v.seconds * 1000);
  try { return new Date(v); } catch { return null; }
}

/** Robust revenue resolver (matches your checkout persistence) */
function getOrderRevenue(o: OrderDoc): number {
  const cents = o.totalsCents?.grandTotalWithTaxCents;
  if (Number.isFinite(cents)) return (cents as number) / 100;

  const withTax = o.totals?.grandTotalWithTax;
  if (Number.isFinite(withTax)) return withTax as number;

  const pay = o.payment?.amount;
  if (Number.isFinite(pay)) return pay as number;

  const legacy = o.orderTotal;
  if (Number.isFinite(legacy)) return legacy as number;

  return 0;
}

function getOrderType(o: OrderDoc): string {
  return o.orderInfo?.type || "unknown";
}

/** Grouping key formats */
function fmtKey(d: Date, p: Period): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  if (p === "day") return `${y}-${m}-${day}`;
  if (p === "month") return `${y}-${m}`;

  // ISO-ish week number
  const tmp = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = (tmp.getUTCDay() + 6) % 7;
  tmp.setUTCDate(tmp.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 4));
  const week =
    1 +
    Math.round(
      ((tmp.getTime() - firstThursday.getTime()) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7
    );
  return `${y}-W${String(week).padStart(2, "0")}`;
}

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function endOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

/** ===== Pie Chart (SVG, no deps) ===== */
type PieRow = { label: string; value: number; color?: string };
function hsl(i: number, total: number) {
  const hue = Math.round((360 * i) / Math.max(1, total));
  return `hsl(${hue} 70% 55%)`;
}
function polarToCartesian(cx: number, cy: number, r: number, angle: number) {
  const rad = (angle - 90) * Math.PI / 180.0;
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
  currency = false,
  compactLabels = false,
}: {
  rows: PieRow[];
  size?: number;
  title: string;
  currency?: boolean;
  compactLabels?: boolean;
}) {
  const fmtQ = useFmtQ();
  const total = rows.reduce((s, r) => s + (Number(r.value) || 0), 0);
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 4;

  let angle = 0;
  const slices = rows.map((row, i) => {
    const pct = total > 0 ? (row.value / total) : 0;
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
                  <div key={s.key} className="d-flex align-items-center justify-content-between border rounded px-2 py-1">
                    <div className="d-flex align-items-center gap-2">
                      <span className="rounded-circle" style={{ display: "inline-block", width: 12, height: 12, background: s.fill }} />
                      <span className="small">{compactLabels ? s.label.slice(5) : s.label}</span>
                    </div>
                    <div className="small text-muted">
                      {currency ? fmtQ(s.value) : s.value} · {(s.pct * 100).toFixed(1)}%
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

/** ====== Excel (SpreadsheetML 2003) without libs ====== */
type Sheet = { name: string; headers: (string)[]; rows: (string | number)[][] };

function xmlEscape(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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
<DocumentProperties xmlns="urn:schemas-microsoft-com:office:office">
  <Author>OrderCraft</Author>
  <Created>${new Date().toISOString()}</Created>
  <Version>16.00</Version>
</DocumentProperties>
<Styles>
  <Style ss:ID="sHeader">
    <Font ss:Bold="1"/>
    <Interior ss:Color="#F2F2F2" ss:Pattern="Solid"/>
  </Style>
  <Style ss:ID="sMoney">
    <NumberFormat ss:Format="Currency"/>
  </Style>
  <Style ss:ID="sNumber">
    <NumberFormat ss:Format="General Number"/>
  </Style>
</Styles>`;

  const sheetsXml = sheets
    .map((sheet) => {
      const cols = sheet.headers
        .map(() => `<Column ss:AutoFitWidth="1" ss:Width="120"/>`)
        .join("\n");

      const headRow =
        `<Row>` +
        sheet.headers
          .map((h) => `<Cell ss:StyleID="sHeader"><Data ss:Type="String">${xmlEscape(h)}</Data></Cell>`)
          .join("") +
        `</Row>`;

      const bodyRows = sheet.rows
        .map((r) => {
          const cells = r
            .map((v) => {
              if (typeof v === "number" && Number.isFinite(v)) {
                return `<Cell ss:StyleID="${Number.isInteger(v) ? "sNumber" : "sMoney"}"><Data ss:Type="Number">${v}</Data></Cell>`;
              }
              return `<Cell><Data ss:Type="String">${xmlEscape(String(v))}</Data></Cell>`;
            })
            .join("");
          return `<Row>${cells}</Row>`;
        })
        .join("\n");

      return `<Worksheet ss:Name="${xmlEscape(sheet.name)}">
<Table>
${cols}
${headRow}
${bodyRows}
</Table>
</Worksheet>`;
    })
    .join("\n");

  const end = `</Workbook>`;
  return header + sheetsXml + end;
}

function downloadExcelXml(filename: string, xml: string) {
  const blob = new Blob([xml], { type: "application/vnd.ms-excel" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".xls") ? filename : `${filename}.xls`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 0);
}

/** ====== Page ====== */
export default function AdminSalesReportPage() {
  const db = getFirestore();
  const fmtQ = useFmtQ();

  // ===== Filters =====
  const [preset, setPreset] = useState<"today" | "7d" | "30d" | "thisMonth" | "custom">("30d");
  const [fromStr, setFromStr] = useState<string>("");
  const [toStr, setToStr] = useState<string>("");

  // initialize range for 30d
  useEffect(() => {
    const today = new Date();
    const to = endOfDay(today);
    const from = new Date();
    from.setDate(from.getDate() - 29);
    setFromStr(from.toISOString().slice(0, 10));
    setToStr(to.toISOString().slice(0, 10));
  }, []);

  // recompute range on preset change (except custom)
  useEffect(() => {
    if (preset === "custom") return;
    const now = new Date();

    if (preset === "today") {
      setFromStr(startOfDay(now).toISOString().slice(0, 10));
      setToStr(endOfDay(now).toISOString().slice(0, 10));
      return;
    }
    if (preset === "7d") {
      const from = new Date();
      from.setDate(from.getDate() - 6);
      setFromStr(from.toISOString().slice(0, 10));
      setToStr(endOfDay(now).toISOString().slice(0, 10));
      return;
    }
    if (preset === "30d") {
      const from = new Date();
      from.setDate(from.getDate() - 29);
      setFromStr(from.toISOString().slice(0, 10));
      setToStr(endOfDay(now).toISOString().slice(0, 10));
      return;
    }
    if (preset === "thisMonth") {
      const from = new Date(now.getFullYear(), now.getMonth(), 1);
      const to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      setFromStr(from.toISOString().slice(0, 10));
      setToStr(to.toISOString().slice(0, 10));
      return;
    }
  }, [preset]);

  // ===== Data load =====
  const [loading, setLoading] = useState(false);
  const [orders, setOrders] = useState<OrderDoc[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setError(null);
    setLoading(true);
    try {
      const from = startOfDay(new Date(fromStr));
      const to = endOfDay(new Date(toStr));

      const qRef = query(
        collection(db, "orders"),
        where("createdAt", ">=", Timestamp.fromDate(from)),
        where("createdAt", "<=", Timestamp.fromDate(to)),
        orderBy("createdAt", "asc")
      );
      const snap = await getDocs(qRef);
      const arr: OrderDoc[] = snap.docs.map((d) => {
        const raw = d.data() as any;
        return {
          id: d.id,
          createdAt: raw.createdAt ?? null,
          orderInfo: raw.orderInfo ?? null,
          orderTotal: Number(raw.orderTotal ?? raw?.totals?.grandTotalWithTax ?? 0),
          payment: raw.payment ?? null,
          totals: raw.totals ?? null,
          totalsCents: raw.totalsCents ?? null,
        };
      });
      setOrders(arr);
    } catch (e: any) {
      setError(e?.message || "Failed to load orders.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (fromStr && toStr) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromStr, toStr]);

  // ===== Aggregations =====
  const totalOrders = orders.length;
  const totalRevenue = useMemo(
    () => orders.reduce((sum, o) => sum + getOrderRevenue(o), 0),
    [orders]
  );
  const avgTicket = totalOrders > 0 ? totalRevenue / totalOrders : 0;

  const byType = useMemo(() => {
    const m = new Map<string, { count: number; revenue: number }>();
    for (const o of orders) {
      const t = getOrderType(o);
      const r = getOrderRevenue(o);
      const cur = m.get(t) || { count: 0, revenue: 0 };
      cur.count += 1;
      cur.revenue += r;
      m.set(t, cur);
    }
    return Array.from(m.entries()).map(([type, v]) => ({ type, ...v }));
  }, [orders]);

  function group(period: Period) {
    const m = new Map<string, { count: number; revenue: number }>();
    for (const o of orders) {
      const d0 = toDate(o.createdAt);
      if (!d0) continue;
      const key = fmtKey(d0, period);
      const r = getOrderRevenue(o);
      const cur = m.get(key) || { count: 0, revenue: 0 };
      cur.count += 1;
      cur.revenue += r;
      m.set(key, cur);
    }
    return Array.from(m.entries())
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => ({ key: k, ...v }));
  }

  const daily = useMemo(() => group("day"), [orders]);
  const weekly = useMemo(() => group("week"), [orders]);
  const monthly = useMemo(() => group("month"), [orders]);

  /** ===== DATA for PIEs ===== */
  const dailyRevenuePie: PieRow[] = useMemo(
    () => daily.map(d => ({ label: d.key, value: d.revenue })),
    [daily]
  );
  const dailyOrdersPie: PieRow[] = useMemo(
    () => daily.map(d => ({ label: d.key, value: d.count })),
    [daily]
  );
  const typePie: PieRow[] = useMemo(
    () => byType.map(t => ({ label: t.type, value: t.count })),
    [byType]
  );

  // Moneda para headers de Excel
  const currency = useMemo(() => orders[0]?.payment?.currency || "USD", [orders]);

  /** ===== Build Excel (multi-tab) ===== */
  function onExportExcel() {
    const dailySheet: Sheet = {
      name: "Daily",
      headers: ["Day", "Orders", `Revenue (${currency})`, `Avg Ticket (${currency})`],
      rows: daily.map(d => [
        d.key,
        d.count,
        Number((d.revenue).toFixed(2)),
        Number((d.count ? d.revenue / d.count : 0).toFixed(2)),
      ]),
    };
    const weeklySheet: Sheet = {
      name: "Weekly",
      headers: ["Week", "Orders", `Revenue (${currency})`, `Avg Ticket (${currency})`],
      rows: weekly.map(w => [
        w.key,
        w.count,
        Number((w.revenue).toFixed(2)),
        Number((w.count ? w.revenue / w.count : 0).toFixed(2)),
      ]),
    };
    const monthlySheet: Sheet = {
      name: "Monthly",
      headers: ["Month", "Orders", `Revenue (${currency})`, `Avg Ticket (${currency})`],
      rows: monthly.map(m => [
        m.key,
        m.count,
        Number((m.revenue).toFixed(2)),
        Number((m.count ? m.revenue / m.count : 0).toFixed(2)),
      ]),
    };
    const byTypeSheet: Sheet = {
      name: "ByType",
      headers: ["Type", "Orders", `Revenue (${currency})`],
      rows: byType.map(t => [
        t.type,
        t.count,
        Number((t.revenue).toFixed(2)),
      ]),
    };

    const xml = buildExcelXml([dailySheet, weeklySheet, monthlySheet, byTypeSheet]);
    const from = fromStr || "";
    const to = toStr || "";
    downloadExcelXml(`sales_${from}_to_${to}.xls`, xml);
  }

  return (
    <Protected>
      <AdminOnly>
        <main className="container py-4">
          <h1 className="h4 mb-3">Sales Report</h1>

          {/* Filters */}
          <div className="card border-0 shadow-sm mb-3">
            <div className="card-body">
              <div className="row g-3">
                <div className="col-12 col-md-3">
                  <label className="form-label fw-semibold">Range</label>
                  <select
                    className="form-select"
                    value={preset}
                    onChange={(e) => setPreset(e.target.value as any)}
                  >
                    <option value="today">Today</option>
                    <option value="7d">Last 7 days</option>
                    <option value="30d">Last 30 days</option>
                    <option value="thisMonth">This month</option>
                    <option value="custom">Custom</option>
                  </select>
                </div>
                <div className="col-6 col-md-3">
                  <label className="form-label fw-semibold">From</label>
                  <input
                    type="date"
                    className="form-control"
                    value={fromStr}
                    onChange={(e) => { setFromStr(e.target.value); setPreset("custom"); }}
                  />
                </div>
                <div className="col-6 col-md-3">
                  <label className="form-label fw-semibold">To</label>
                  <input
                    type="date"
                    className="form-control"
                    value={toStr}
                    onChange={(e) => { setToStr(e.target.value); setPreset("custom"); }}
                  />
                </div>
                <div className="col-12 col-md-3 d-flex align-items-end">
                  <div className="d-flex gap-2 w-100">
                    <button
                      className="btn btn-primary flex-fill"
                      onClick={load}
                      disabled={loading}
                    >
                      {loading ? "Loading…" : "Refresh"}
                    </button>
                    <button
                      className="btn btn-outline-success"
                      onClick={onExportExcel}
                      disabled={loading || (daily.length + weekly.length + monthly.length + byType.length) === 0}
                      title="Export Excel with tabs: Daily, Weekly, Monthly, ByType"
                    >
                      Export to Excel
                    </button>
                  </div>
                </div>
              </div>
              {error && <div className="text-danger small mt-2">{error}</div>}
            </div>
          </div>

          {/* KPIs */}
          <div className="row g-3 mb-3">
            <div className="col-12 col-md-3">
              <div className="card border-0 shadow-sm">
                <div className="card-body">
                  <div className="text-muted small">Orders</div>
                  <div className="h4 mb-0">{totalOrders}</div>
                </div>
              </div>
            </div>
            <div className="col-12 col-md-3">
              <div className="card border-0 shadow-sm">
                <div className="card-body">
                  <div className="text-muted small">Revenue</div>
                  <div className="h4 mb-0">{fmtQ(totalRevenue)}</div>
                </div>
              </div>
            </div>
            <div className="col-12 col-md-3">
              <div className="card border-0 shadow-sm">
                <div className="card-body">
                  <div className="text-muted small">Avg. Ticket</div>
                  <div className="h4 mb-0">{fmtQ(avgTicket)}</div>
                </div>
              </div>
            </div>
            <div className="col-12 col-md-3">
              <div className="card border-0 shadow-sm">
                <div className="card-body">
                  <div className="text-muted small">By Order Type</div>
                  <div className="d-flex flex-wrap gap-2">
                    {byType.length === 0 && <span className="text-muted small">No data</span>}
                    {byType.map((t) => (
                      <span key={t.type} className="badge text-bg-light border">
                        {t.type}: {t.count} ({fmtQ(t.revenue)})
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Tables */}
          <div className="row g-3">
            <div className="col-12 col-lg-4">
              <div className="card border-0 shadow-sm h-100">
                <div className="card-header fw-semibold">Daily</div>
                <div className="card-body p-0">
                  <table className="table mb-0">
                    <thead>
                      <tr>
                        <th style={{ width: "40%" }}>Day</th>
                        <th className="text-end">Orders</th>
                        <th className="text-end">Revenue</th>
                      </tr>
                    </thead>
                    <tbody>
                      {daily.length === 0 && (
                        <tr><td colSpan={3} className="text-center text-muted">No data</td></tr>
                      )}
                      {daily.map((r) => (
                        <tr key={r.key}>
                          <td>{r.key}</td>
                          <td className="text-end">{r.count}</td>
                          <td className="text-end">{fmtQ(r.revenue)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div className="col-12 col-lg-4">
              <div className="card border-0 shadow-sm h-100">
                <div className="card-header fw-semibold">Weekly</div>
                <div className="card-body p-0">
                  <table className="table mb-0">
                    <thead>
                      <tr>
                        <th style={{ width: "40%" }}>Week</th>
                        <th className="text-end">Orders</th>
                        <th className="text-end">Revenue</th>
                      </tr>
                    </thead>
                    <tbody>
                      {weekly.length === 0 && (
                        <tr><td colSpan={3} className="text-center text-muted">No data</td></tr>
                      )}
                      {weekly.map((r) => (
                        <tr key={r.key}>
                          <td>{r.key}</td>
                          <td className="text-end">{r.count}</td>
                          <td className="text-end">{fmtQ(r.revenue)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div className="col-12 col-lg-4">
              <div className="card border-0 shadow-sm h-100">
                <div className="card-header fw-semibold">Monthly</div>
                <div className="card-body p-0">
                  <table className="table mb-0">
                    <thead>
                      <tr>
                        <th style={{ width: "40%" }}>Month</th>
                        <th className="text-end">Orders</th>
                        <th className="text-end">Revenue</th>
                      </tr>
                    </thead>
                    <tbody>
                      {monthly.length === 0 && (
                        <tr><td colSpan={3} className="text-center text-muted">No data</td></tr>
                      )}
                      {monthly.map((r) => (
                        <tr key={r.key}>
                          <td>{r.key}</td>
                          <td className="text-end">{r.count}</td>
                          <td className="text-end">{fmtQ(r.revenue)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>

          {/* ===== Mobile-first PIE charts (bottom) ===== */}
          <div className="row g-3 mt-3">
            <div className="col-12 col-lg-4">
              <PieChart
                rows={dailyRevenuePie}
                title="Daily Revenue (Pie)"
                currency
                compactLabels
              />
            </div>
            <div className="col-12 col-lg-4">
              <PieChart
                rows={dailyOrdersPie}
                title="Daily Orders (Pie)"
                compactLabels
              />
            </div>
            <div className="col-12 col-lg-4">
              <PieChart
                rows={typePie}
                title="Orders by Type (Pie)"
              />
            </div>
          </div>

          <div className="text-muted small mt-3">
          </div>
        </main>
      </AdminOnly>
    </Protected>
  );
}
