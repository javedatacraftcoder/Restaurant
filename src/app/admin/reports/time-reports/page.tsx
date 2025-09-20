// src/app/admin/time-reports/page.tsx
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

/** ========= SLA CONFIG (puedes ajustar) ========= */
const SLA = {
  placed_to_kip: { goodMin: 10, warnMin: 20 },
  kip_to_done: { goodMin: 15, warnMin: 30 },
  done_to_inroute: { goodMin: 8, warnMin: 15 },
  inroute_to_delivered: { goodMin: 20, warnMin: 40 },
};

/** ========= Types ========= */
type StatusHist = { at?: any; from?: string; to?: string; by?: string };
type DeliveryTimeline = { pendingAt?: any; inrouteAt?: any; deliveredAt?: any };

type OrderDoc = {
  id: string;
  orderNumber?: string | null;
  createdAt?: Timestamp | { seconds: number } | Date | string | null;
  statusHistory?: StatusHist[] | null;
  orderInfo?: {
    type?: "dine-in" | "delivery";
    delivery?: "pending" | "inroute" | "delivered";
    deliveryTimeline?: DeliveryTimeline | null;
  } | null;
};

/** ========= Utils ========= */
const LOCAL_TZ = "America/Guatemala";

function toDate(v: any): Date | null {
  if (!v) return null;
  if (v instanceof Date) return v;
  if (typeof v === "string") {
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }
  if ((v as any)?.toDate) {
    try {
      const d = (v as any).toDate();
      return d instanceof Date ? d : null;
    } catch {}
  }
  if (typeof (v as any)?.seconds === "number") {
    return new Date((v as any).seconds * 1000);
  }
  try {
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}
function msBetween(a: Date | null, b: Date | null): number | null {
  if (!a || !b) return null;
  return b.getTime() - a.getTime();
}
function mmBetween(a: Date | null, b: Date | null): number | null {
  const ms = msBetween(a, b);
  return ms == null ? null : Math.round(ms / 60000);
}
function fmtHMS(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  const s = Math.max(0, Math.floor(ms / 1000));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(hh)}:${pad(mm)}:${pad(ss)}`;
}
function fmtMin(m: number | null): string {
  if (m == null || !Number.isFinite(m)) return "—";
  return `${m} min`;
}
function msToMin(ms: number | null): number | null {
  return ms == null ? null : Math.round(ms / 60000);
}
function fmtLocal(d: Date | null): string {
  if (!d) return "—";
  // Fecha y hora locales (Guatemala) con segundos
  return new Intl.DateTimeFormat("en-US", {
    timeZone: LOCAL_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })
    .format(d)
    .replace(",", "");
}

/** Color de estado según SLA */
function colorBySLA(minVal: number | null, sla: { goodMin: number; warnMin: number }) {
  if (minVal == null) return "secondary";
  if (minVal <= sla.goodMin) return "success";
  if (minVal <= sla.warnMin) return "warning";
  return "danger";
}

/** Barra de progreso % contra meta "good" */
function pctOfTarget(minVal: number | null, targetMin: number) {
  if (minVal == null) return 0;
  return Math.min(150, Math.round((minVal / targetMin) * 100));
}

/** ========= Excel (SpreadsheetML 2003) ========= */
type Sheet = { name: string; headers: string[]; rows: (string | number)[][] };
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
<Styles>
  <Style ss:ID="sHeader"><Font ss:Bold="1"/><Interior ss:Color="#F2F2F2" ss:Pattern="Solid"/></Style>
  <Style ss:ID="sNumber"><NumberFormat ss:Format="General Number"/></Style>
</Styles>`;
  const sheetsXml = sheets
    .map((sheet) => {
      const cols = sheet.headers.map(() => `<Column ss:AutoFitWidth="1" ss:Width="160"/>`).join("");
      const headRow =
        `<Row>` +
        sheet.headers
          .map(
            (h) =>
              `<Cell ss:StyleID="sHeader"><Data ss:Type="String">${xmlEscape(
                h
              )}</Data></Cell>`
          )
          .join("") +
        `</Row>`;
      const bodyRows = sheet.rows
        .map((r) => {
          const cells = r
            .map((v) =>
              typeof v === "number" && Number.isFinite(v)
                ? `<Cell ss:StyleID="sNumber"><Data ss:Type="Number">${v}</Data></Cell>`
                : `<Cell><Data ss:Type="String">${xmlEscape(String(v))}</Data></Cell>`
            )
            .join("");
          return `<Row>${cells}</Row>`;
        })
        .join("\n");
      return `<Worksheet ss:Name="${xmlEscape(sheet.name)}"><Table>${cols}${headRow}${bodyRows}</Table></Worksheet>`;
    })
    .join("\n");
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
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 0);
}

/** ========= Page ========= */
export default function AdminTimeReportsPage() {
  const db = getFirestore();

  const [preset, setPreset] = useState<"today" | "7d" | "30d" | "thisMonth" | "custom">("30d");
  const [fromStr, setFromStr] = useState<string>("");
  const [toStr, setToStr] = useState<string>("");
  const [showMinutes, setShowMinutes] = useState<boolean>(false);

  useEffect(() => {
    const today = new Date();
    const to = new Date(today);
    to.setHours(23, 59, 59, 999);
    const from = new Date();
    from.setDate(from.getDate() - 29);
    from.setHours(0, 0, 0, 0);
    setFromStr(from.toISOString().slice(0, 10));
    setToStr(to.toISOString().slice(0, 10));
  }, []);
  useEffect(() => {
    if (preset === "custom") return;
    const now = new Date();
    if (preset === "today") {
      const f = new Date(now);
      f.setHours(0, 0, 0, 0);
      const t = new Date(now);
      t.setHours(23, 59, 59, 999);
      setFromStr(f.toISOString().slice(0, 10));
      setToStr(t.toISOString().slice(0, 10));
      return;
    }
    if (preset === "7d") {
      const f = new Date();
      f.setDate(f.getDate() - 6);
      f.setHours(0, 0, 0, 0);
      const t = new Date(now);
      t.setHours(23, 59, 59, 999);
      setFromStr(f.toISOString().slice(0, 10));
      setToStr(t.toISOString().slice(0, 10));
      return;
    }
    if (preset === "30d") {
      const f = new Date();
      f.setDate(f.getDate() - 29);
      f.setHours(0, 0, 0, 0);
      const t = new Date(now);
      t.setHours(23, 59, 59, 999);
      setFromStr(f.toISOString().slice(0, 10));
      setToStr(t.toISOString().slice(0, 10));
      return;
    }
    if (preset === "thisMonth") {
      const f = new Date(now.getFullYear(), now.getMonth(), 1);
      const t = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      setFromStr(f.toISOString().slice(0, 10));
      setToStr(t.toISOString().slice(0, 10));
      return;
    }
  }, [preset]);

  // Data
  const [loading, setLoading] = useState(false);
  const [orders, setOrders] = useState<OrderDoc[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setError(null);
    setLoading(true);
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
        return {
          id: d.id,
          orderNumber: raw.orderNumber ?? null,
          createdAt: raw.createdAt ?? null,
          statusHistory: Array.isArray(raw.statusHistory) ? raw.statusHistory : [],
          orderInfo: raw.orderInfo ?? null,
        };
      });
      setOrders(arr);
    } catch (e: any) {
      setError(e?.message || "Failed to load data.");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    if (fromStr && toStr) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromStr, toStr]);

  /** ========= Compute per order ========= */
  type Row = {
    id: string;
    orderNumber?: string | null;

    placedAt: Date | null; // SIEMPRE creado desde createdAt (local fix)
    kipAt: Date | null;
    doneAt: Date | null;
    inrouteAt: Date | null;
    deliveredAt: Date | null;

    // Durations (ms)
    d_placed_to_kip: number | null;
    d_kip_to_done: number | null;
    d_done_to_inroute: number | null;
    d_inroute_to_delivered: number | null;
  };

  const rows: Row[] = useMemo(() => {
    return orders.map((o) => {
      const sh = Array.isArray(o.statusHistory) ? o.statusHistory : [];

      // --- FIX #1: Placed = createdAt (siempre que exista) ---
      const created = toDate(o.createdAt);

      // evento cuando ENTRA a 'kitchen_in_progress'
      const kipEvt = sh.find((x) => (x?.to || "") === "kitchen_in_progress") || null;
      const doneEvt = sh.find((x) => (x?.to || "") === "kitchen_done") || null;

      // si por alguna razón no hay createdAt, intentamos tiempo cuando ENTRA a 'placed'
      const placedEnteredEvt = sh.find((x) => (x?.to || "") === "placed") || null;

      const placedAt = created ?? toDate(placedEnteredEvt?.at) ?? null;
      const kipAt = toDate(kipEvt?.at);
      const doneAt = toDate(doneEvt?.at);

      const inrouteAt = toDate(o.orderInfo?.deliveryTimeline?.inrouteAt);
      const deliveredAt = toDate(o.orderInfo?.deliveryTimeline?.deliveredAt);

      return {
        id: o.id,
        orderNumber: o.orderNumber ?? null,
        placedAt,
        kipAt,
        doneAt,
        inrouteAt,
        deliveredAt,
        d_placed_to_kip: msBetween(placedAt, kipAt),
        d_kip_to_done: msBetween(kipAt, doneAt),
        d_done_to_inroute: msBetween(doneAt, inrouteAt),
        d_inroute_to_delivered: msBetween(inrouteAt, deliveredAt),
      };
    });
  }, [orders]);

  /** ========= KPIs ========= */
  function avgMs(arr: (number | null)[]) {
    const xs = arr.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    if (!xs.length) return null;
    return Math.round(xs.reduce((s, v) => s + v, 0) / xs.length);
  }
  const kpi_orders = rows.length;
  const kpi_avg_placed_to_kip = useMemo(
    () => avgMs(rows.map((r) => r.d_placed_to_kip)),
    [rows]
  );
  const kpi_avg_kip_to_done = useMemo(
    () => avgMs(rows.map((r) => r.d_kip_to_done)),
    [rows]
  );
  const kpi_avg_done_to_inroute = useMemo(
    () => avgMs(rows.map((r) => r.d_done_to_inroute)),
    [rows]
  );
  const kpi_avg_inroute_to_delivered = useMemo(
    () => avgMs(rows.map((r) => r.d_inroute_to_delivered)),
    [rows]
  );

  /** ========= Export ========= */
  function onExportExcel() {
    const summary: Sheet = {
      name: "Summary",
      headers: ["Metric", "Value (hh:mm:ss)"],
      rows: [
        ["Orders in range", kpi_orders],
        ["Avg Placed → Kitchen in progress", fmtHMS(kpi_avg_placed_to_kip)],
        ["Avg Kitchen in progress → Kitchen done", fmtHMS(kpi_avg_kip_to_done)],
        ["Avg Kitchen done → Inroute", fmtHMS(kpi_avg_done_to_inroute)],
        ["Avg Inroute → Delivered", fmtHMS(kpi_avg_inroute_to_delivered)],
      ],
    };

    const detail: Sheet = {
      name: "OrderDurations",
      headers: [
        "Order",
        "PlacedAt (UTC)",
        "K.InProgress (UTC)",
        "K.Done (UTC)",
        "Inroute (UTC)",
        "Delivered (UTC)",
        "Placed→KIP (min)",
        "KIP→Done (min)",
        "Done→Inroute (min)",
        "Inroute→Delivered (min)",
        "Placed→KIP (hh:mm:ss)",
        "KIP→Done (hh:mm:ss)",
        "Done→Inroute (hh:mm:ss)",
        "Inroute→Delivered (hh:mm:ss)",
      ],
      rows: rows.map((r) => {
        const id = r.orderNumber ? `#${r.orderNumber}` : r.id;
        const iso = (d: Date | null) =>
          d ? d.toISOString().replace("T", " ").slice(0, 19) : "";
        const min = (ms: number | null) =>
          ms == null ? "" : Math.round(ms / 60000);
        return [
          id,
          iso(r.placedAt),
          iso(r.kipAt),
          iso(r.doneAt),
          iso(r.inrouteAt),
          iso(r.deliveredAt),
          min(r.d_placed_to_kip),
          min(r.d_kip_to_done),
          min(r.d_done_to_inroute),
          min(r.d_inroute_to_delivered),
          fmtHMS(r.d_placed_to_kip),
          fmtHMS(r.d_kip_to_done),
          fmtHMS(r.d_done_to_inroute),
          fmtHMS(r.d_inroute_to_delivered),
        ];
      }),
    };

    const xml = buildExcelXml([summary, detail]);
    downloadExcelXml(`time_report_${fromStr}_to_${toStr}.xls`, xml);
  }

  /** ========= Helpers UI ========= */
  function DurationBadge({
    label,
    ms,
    sla,
    minutesMode,
  }: {
    label: string;
    ms: number | null;
    sla: { goodMin: number; warnMin: number };
    minutesMode: boolean;
  }) {
    const m = msToMin(ms);
    const color = colorBySLA(m, sla);
    const text = minutesMode ? fmtMin(m) : fmtHMS(ms);
    return (
      <span className={`badge text-bg-${color} rounded-pill`} title={`${label}: ${text}`}>
        {label}: {text}
      </span>
    );
  }

  function OrderTimeline({ r, minutesMode }: { r: Row; minutesMode: boolean }) {
    const segs = [
      { key: "Placed→KIP", ms: r.d_placed_to_kip, color: "#198754" },
      { key: "KIP→Done", ms: r.d_kip_to_done, color: "#0d6efd" },
      { key: "Done→Inroute", ms: r.d_done_to_inroute, color: "#ffc107" },
      { key: "Inroute→Delivered", ms: r.d_inroute_to_delivered, color: "#dc3545" },
    ];
    const totalMs = segs.reduce((s, x) => (x.ms ? s + x.ms : s), 0);
    if (!totalMs) {
      return (
        <div
          className="w-100"
          style={{
            height: 10,
            background:
              "repeating-linear-gradient(90deg,#e9ecef,#e9ecef 8px,#f8f9fa 8px,#f8f9fa 16px)",
            borderRadius: 8,
          }}
          title="No timeline"
        />
      );
    }
    return (
      <div className="d-flex align-items-center gap-2">
        <div
          className="flex-grow-1 d-flex"
          style={{ height: 12, borderRadius: 8, overflow: "hidden", background: "#e9ecef" }}
        >
          {segs.map((s, idx) => {
            const w = s.ms ? Math.max(2, Math.round((s.ms / totalMs) * 100)) : 0;
            if (!s.ms) return null;
            const tooltip = `${s.key}: ${minutesMode ? fmtMin(msToMin(s.ms)) : fmtHMS(s.ms)}`;
            return <div key={idx} title={tooltip} style={{ width: `${w}%`, background: s.color }} />;
          })}
        </div>
        <div
          className="text-nowrap small text-muted"
          title={`Total: ${minutesMode ? fmtMin(msToMin(totalMs)) : fmtHMS(totalMs)}`}
        >
          {minutesMode ? fmtMin(msToMin(totalMs)) : fmtHMS(totalMs)}
        </div>
      </div>
    );
  }

  return (
    <Protected>
      <AdminOnly>
        <main className="container py-4">
          <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3">
            <h1 className="h4 mb-0">Operational Time Reports</h1>
            <div className="form-check form-switch">
              <input
                className="form-check-input"
                type="checkbox"
                id="toggleMinutes"
                checked={showMinutes}
                onChange={(e) => setShowMinutes(e.target.checked)}
              />
              <label className="form-check-label" htmlFor="toggleMinutes">
                Show minutes
              </label>
            </div>
          </div>

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
                    onChange={(e) => {
                      setFromStr(e.target.value);
                      setPreset("custom");
                    }}
                  />
                </div>
                <div className="col-6 col-md-3">
                  <label className="form-label fw-semibold">To</label>
                  <input
                    type="date"
                    className="form-control"
                    value={toStr}
                    onChange={(e) => {
                      setToStr(e.target.value);
                      setPreset("custom");
                    }}
                  />
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

              {/* Leyenda SLA */}
              <div className="mt-3">
                <div className="small fw-semibold mb-1">Legend (SLA)</div>
                <div className="d-flex flex-wrap align-items-center gap-2 small">
                  <span className="badge text-bg-success">Good</span>
                  <span className="badge text-bg-warning">Warning</span>
                  <span className="badge text-bg-danger">High</span>
                  <span className="text-muted ms-2">
                    Placed→KIP ≤ {SLA.placed_to_kip.goodMin}m (good), ≤ {SLA.placed_to_kip.warnMin}m (warn), etc.
                  </span>
                </div>
              </div>

              <div className="text-muted small mt-2">
                Times computed with <code>createdAt</code> for Placed, <code>statusHistory</code> for
                kitchen, and <code>orderInfo.deliveryTimeline</code> for delivery. Missing timestamps render as “—”.
              </div>
            </div>
          </div>

          {/* KPI Cards */}
          <div className="row g-3 mb-3">
            <div className="col-12 col-md-6 col-lg-3">
              <div className="card border-0 shadow-sm h-100">
                <div className="card-body">
                  <div className="text-muted small">Orders</div>
                  <div className="h4 mb-0">{kpi_orders}</div>
                </div>
              </div>
            </div>

            {/* Placed -> KIP */}
            <div className="col-12 col-md-6 col-lg-3">
              <div className="card border-0 shadow-sm h-100">
                <div className="card-body">
                  <div className="d-flex justify-content-between align-items-center">
                    <div className="text-muted small">Avg Placed → K.InProgress</div>
                    <span
                      className={`badge text-bg-${colorBySLA(
                        msToMin(kpi_avg_placed_to_kip),
                        SLA.placed_to_kip
                      )}`}
                    >
                      {showMinutes ? fmtMin(msToMin(kpi_avg_placed_to_kip)) : fmtHMS(kpi_avg_placed_to_kip)}
                    </span>
                  </div>
                  <div className="progress mt-2" role="progressbar" aria-label="Placed to KIP">
                    <div
                      className={`progress-bar bg-${colorBySLA(
                        msToMin(kpi_avg_placed_to_kip),
                        SLA.placed_to_kip
                      )}`}
                      style={{
                        width: `${pctOfTarget(msToMin(kpi_avg_placed_to_kip), SLA.placed_to_kip.goodMin)}%`,
                      }}
                    />
                  </div>
                  <div className="small text-muted mt-1">Target ≤ {SLA.placed_to_kip.goodMin} min</div>
                </div>
              </div>
            </div>

            {/* KIP -> Done */}
            <div className="col-12 col-md-6 col-lg-3">
              <div className="card border-0 shadow-sm h-100">
                <div className="card-body">
                  <div className="d-flex justify-content-between align-items-center">
                    <div className="text-muted small">Avg K.InProgress → K.Done</div>
                    <span
                      className={`badge text-bg-${colorBySLA(
                        msToMin(kpi_avg_kip_to_done),
                        SLA.kip_to_done
                      )}`}
                    >
                      {showMinutes ? fmtMin(msToMin(kpi_avg_kip_to_done)) : fmtHMS(kpi_avg_kip_to_done)}
                    </span>
                  </div>
                  <div className="progress mt-2" role="progressbar" aria-label="KIP to Done">
                    <div
                      className={`progress-bar bg-${colorBySLA(
                        msToMin(kpi_avg_kip_to_done),
                        SLA.kip_to_done
                      )}`}
                      style={{
                        width: `${pctOfTarget(msToMin(kpi_avg_kip_to_done), SLA.kip_to_done.goodMin)}%`,
                      }}
                    />
                  </div>
                  <div className="small text-muted mt-1">Target ≤ {SLA.kip_to_done.goodMin} min</div>
                </div>
              </div>
            </div>

            {/* Done -> Inroute */}
            <div className="col-12 col-md-6 col-lg-3">
              <div className="card border-0 shadow-sm h-100">
                <div className="card-body">
                  <div className="d-flex justify-content-between align-items-center">
                    <div className="text-muted small">Avg K.Done → Inroute</div>
                    <span
                      className={`badge text-bg-${colorBySLA(
                        msToMin(kpi_avg_done_to_inroute),
                        SLA.done_to_inroute
                      )}`}
                    >
                      {showMinutes ? fmtMin(msToMin(kpi_avg_done_to_inroute)) : fmtHMS(kpi_avg_done_to_inroute)}
                    </span>
                  </div>
                  <div className="progress mt-2" role="progressbar" aria-label="Done to Inroute">
                    <div
                      className={`progress-bar bg-${colorBySLA(
                        msToMin(kpi_avg_done_to_inroute),
                        SLA.done_to_inroute
                      )}`}
                      style={{
                        width: `${pctOfTarget(msToMin(kpi_avg_done_to_inroute), SLA.done_to_inroute.goodMin)}%`,
                      }}
                    />
                  </div>
                  <div className="small text-muted mt-1">Target ≤ {SLA.done_to_inroute.goodMin} min</div>
                </div>
              </div>
            </div>

            {/* Inroute -> Delivered */}
            <div className="col-12 col-md-6 col-lg-3">
              <div className="card border-0 shadow-sm h-100">
                <div className="card-body">
                  <div className="d-flex justify-content-between align-items-center">
                    <div className="text-muted small">Avg Inroute → Delivered</div>
                    <span
                      className={`badge text-bg-${colorBySLA(
                        msToMin(kpi_avg_inroute_to_delivered),
                        SLA.inroute_to_delivered
                      )}`}
                    >
                      {showMinutes ? fmtMin(msToMin(kpi_avg_inroute_to_delivered)) : fmtHMS(kpi_avg_inroute_to_delivered)}
                    </span>
                  </div>
                  <div className="progress mt-2" role="progressbar" aria-label="Inroute to Delivered">
                    <div
                      className={`progress-bar bg-${colorBySLA(
                        msToMin(kpi_avg_inroute_to_delivered),
                        SLA.inroute_to_delivered
                      )}`}
                      style={{
                        width: `${pctOfTarget(msToMin(kpi_avg_inroute_to_delivered), SLA.inroute_to_delivered.goodMin)}%`,
                      }}
                    />
                  </div>
                  <div className="small text-muted mt-1">Target ≤ {SLA.inroute_to_delivered.goodMin} min</div>
                </div>
              </div>
            </div>
          </div>

          {/* Detail table + timeline */}
          <div className="card border-0 shadow-sm">
            <div className="card-header fw-semibold d-flex align-items-center justify-content-between">
              <span>Per-order timings</span>
              <span className="small text-muted">Times shown in {LOCAL_TZ}. Hover the bar to see segments</span>
            </div>
            <div className="card-body p-0">
              <div className="table-responsive">
                <table className="table mb-0 align-middle">
                  <thead>
                    <tr>
                      <th style={{ minWidth: 100 }}>Order</th>
                      <th>Placed</th>
                      <th>K.InProgress</th>
                      <th>K.Done</th>
                      <th>Inroute</th>
                      <th>Delivered</th>
                      <th className="text-end">Durations</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length === 0 && (
                      <tr>
                        <td colSpan={7} className="text-center text-muted">
                          No data
                        </td>
                      </tr>
                    )}
                    {rows.map((r) => {
                      const id = r.orderNumber ? `#${r.orderNumber}` : r.id;

                      return (
                        <tr key={r.id}>
                          <td className="fw-semibold">{id}</td>
                          <td>{fmtLocal(r.placedAt)}</td>
                          <td>{fmtLocal(r.kipAt)}</td>
                          <td>{fmtLocal(r.doneAt)}</td>
                          <td>{fmtLocal(r.inrouteAt)}</td>
                          <td>{fmtLocal(r.deliveredAt)}</td>
                          <td className="text-end">
                            <div className="d-flex flex-column gap-2">
                              <OrderTimeline r={r} minutesMode={showMinutes} />
                              <div className="d-flex flex-wrap gap-2 justify-content-end">
                                <DurationBadge label="Placed→KIP" ms={r.d_placed_to_kip} sla={SLA.placed_to_kip} minutesMode={showMinutes} />
                                <DurationBadge label="KIP→Done" ms={r.d_kip_to_done} sla={SLA.kip_to_done} minutesMode={showMinutes} />
                                <DurationBadge label="Done→Inroute" ms={r.d_done_to_inroute} sla={SLA.done_to_inroute} minutesMode={showMinutes} />
                                <DurationBadge label="Inroute→Delivered" ms={r.d_inroute_to_delivered} sla={SLA.inroute_to_delivered} minutesMode={showMinutes} />
                              </div>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="card-footer small text-muted">
              Delivery metrics only appear for orders with <code>orderInfo.type="delivery"</code> and a populated <code>deliveryTimeline</code>.
            </div>
          </div>
        </main>
      </AdminOnly>
    </Protected>
  );
}
