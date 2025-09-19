// src/app/admin/product-report/page.tsx
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

/** ===== Types ===== */
type OrderItem = {
  menuItemId: string;
  menuItemName: string;
  basePrice?: number;
  quantity: number;
  lineTotal?: number; // incluye addons y options
  addons?: Array<{ name: string; price?: number }>;
  optionGroups?: Array<{
    groupId: string;
    groupName: string;
    type?: "single" | "multi";
    items: Array<{ id: string; name: string; priceDelta?: number }>;
  }>;
};

type OrderDoc = {
  id: string;
  createdAt?: Timestamp | { seconds: number } | Date | null;
  items?: OrderItem[];
  orderInfo?: { type?: "dine-in" | "delivery" | "pickup" | string } | null;
  orderTotal?: number;
  payment?: { amount?: number } | null;
  totals?: { grandTotalWithTax?: number } | null;
  totalsCents?: { grandTotalWithTaxCents?: number } | null;
};

type MenuOptionItemDef = { id: string; name: string; priceDelta?: number };
type MenuOptionGroupDef = {
  groupId: string;
  groupName: string;
  type?: "single" | "multi";
  items?: MenuOptionItemDef[];
};
type MenuAddonDef = { name: string; price?: number };

type MenuMeta = {
  id: string;
  name?: string;
  categoryId?: string | null;
  subcategoryId?: string | null;
  category?: string;
  subcategory?: string;
  // Definiciones del catálogo (opcionales)
  addons?: MenuAddonDef[];
  optionGroups?: MenuOptionGroupDef[];
};

type Period = "day" | "week" | "month";

/** ===== Utilities ===== */
function toDate(v: any): Date | null {
  if (!v) return null;
  if (v instanceof Date) return v;
  if (v?.seconds != null) return new Date(v.seconds * 1000);
  try { return new Date(v); } catch { return null; }
}

function money(n: number | undefined): string {
  const v = Number.isFinite(Number(n)) ? Number(n) : 0;
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(v);
  } catch {
    return `$${v.toFixed(2)}`;
  }
}

/** Resolver de ingreso por orden — consistente con checkout */
function getOrderRevenueUSD(o: OrderDoc): number {
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

/** ===== Pie Chart (SVG, no deps) ===== */
type PieRow = { label: string; value: number; color?: string };
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
  currency = false,
}: {
  rows: PieRow[];
  size?: number;
  title: string;
  currency?: boolean;
}) {
  const total = rows.reduce((s, r) => s + (Number(r.value) || 0), 0);
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 4;

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
                      <span
                        className="rounded-circle"
                        style={{ display: "inline-block", width: 12, height: 12, background: s.fill }}
                      />
                      <span className="small">{s.label}</span>
                    </div>
                    <div className="small text-muted">
                      {currency ? money(s.value) : s.value} · {(s.pct * 100).toFixed(1)}%
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

/** ===== Excel (SpreadsheetML 2003) ===== */
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
  <Style ss:ID="sMoney"><NumberFormat ss:Format="Currency"/></Style>
  <Style ss:ID="sNumber"><NumberFormat ss:Format="General Number"/></Style>
</Styles>`;
  const sheetsXml = sheets
    .map((sheet) => {
      const cols = sheet.headers.map(() => `<Column ss:AutoFitWidth="1" ss:Width="160"/>`).join("");
      const headRow =
        `<Row>` +
        sheet.headers
          .map((h) => `<Cell ss:StyleID="sHeader"><Data ss:Type="String">${xmlEscape(h)}</Data></Cell>`)
          .join("") +
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

/** ===== Page ===== */
export default function AdminProductReportPage() {
  const db = getFirestore();

  // Filters
  const [preset, setPreset] = useState<"today" | "7d" | "30d" | "thisMonth" | "custom">("30d");
  const [fromStr, setFromStr] = useState<string>("");
  const [toStr, setToStr] = useState<string>("");

  useEffect(() => {
    const today = new Date();
    const to = new Date(today); to.setHours(23,59,59,999);
    const from = new Date(); from.setDate(from.getDate() - 29); from.setHours(0,0,0,0);
    setFromStr(from.toISOString().slice(0,10));
    setToStr(to.toISOString().slice(0,10));
  }, []);
  useEffect(() => {
    if (preset === "custom") return;
    const now = new Date();
    if (preset === "today") {
      const f = new Date(now); f.setHours(0,0,0,0);
      const t = new Date(now); t.setHours(23,59,59,999);
      setFromStr(f.toISOString().slice(0,10));
      setToStr(t.toISOString().slice(0,10));
      return;
    }
    if (preset === "7d") {
      const f = new Date(); f.setDate(f.getDate()-6); f.setHours(0,0,0,0);
      const t = new Date(now); t.setHours(23,59,59,999);
      setFromStr(f.toISOString().slice(0,10));
      setToStr(t.toISOString().slice(0,10));
      return;
    }
    if (preset === "30d") {
      const f = new Date(); f.setDate(f.getDate()-29); f.setHours(0,0,0,0);
      const t = new Date(now); t.setHours(23,59,59,999);
      setFromStr(f.toISOString().slice(0,10));
      setToStr(t.toISOString().slice(0,10));
      return;
    }
    if (preset === "thisMonth") {
      const f = new Date(now.getFullYear(), now.getMonth(), 1);
      const t = new Date(now.getFullYear(), now.getMonth()+1, 0);
      setFromStr(f.toISOString().slice(0,10));
      setToStr(t.toISOString().slice(0,10));
      return;
    }
  }, [preset]);

  // Data state
  const [loading, setLoading] = useState(false);
  const [orders, setOrders] = useState<OrderDoc[]>([]);
  const [menuMeta, setMenuMeta] = useState<Record<string, MenuMeta>>({});
  const [error, setError] = useState<string | null>(null);

  /** ===== Load orders + catalog with category resolution ===== */
  async function load() {
    setError(null);
    setLoading(true);
    try {
      const from = new Date(fromStr + "T00:00:00");
      const to = new Date(toStr + "T23:59:59.999");

      // Orders in range
      const qRef = query(
        collection(db, "orders"),
        where("createdAt", ">=", Timestamp.fromDate(from)),
        where("createdAt", "<=", Timestamp.fromDate(to)),
        orderBy("createdAt", "asc")
      );
      const snap = await getDocs(qRef);
      const arr: OrderDoc[] = snap.docs.map((d) => {
        const raw = d.data() as DocumentData;
        return {
          id: d.id,
          createdAt: raw.createdAt ?? null,
          items: Array.isArray(raw.items) ? raw.items : [],
          orderInfo: raw.orderInfo ?? null,
          orderTotal: Number(raw.orderTotal ?? raw?.totals?.grandTotalWithTax ?? 0),
          payment: raw.payment ?? null,
          totals: raw.totals ?? null,
          totalsCents: raw.totalsCents ?? null,
        };
      });
      setOrders(arr);

      // ----- Catalog resolution -----
      // categories map: id -> name
      const catSnap = await getDocs(collection(db, "categories"));
      const catMap: Record<string, string> = {};
      for (const d of catSnap.docs) {
        const r = d.data() as any;
        const nm = (r?.name ?? r?.title ?? "").toString() || d.id;
        catMap[d.id] = nm;
      }

      // subcategories map: id -> name
      const subSnap = await getDocs(collection(db, "subcategories"));
      const subMap: Record<string, string> = {};
      for (const d of subSnap.docs) {
        const r = d.data() as any;
        const nm = (r?.name ?? r?.title ?? "").toString() || d.id;
        subMap[d.id] = nm;
      }

      // menuItems: read categoryId/subcategoryId + resolve names + read extras defs si existen
      const menuSnap = await getDocs(collection(db, "menuItems"));
      const meta: Record<string, MenuMeta> = {};
      for (const d of menuSnap.docs) {
        const r = d.data() as any;
        const categoryId = (r?.categoryId ?? null) as string | null;
        const subcategoryId = (r?.subcategoryId ?? null) as string | null;

        // Intentos seguros de leer catálogos de extras (nombres estándar más comunes):
        const addonDefs: MenuAddonDef[] = Array.isArray(r?.addons)
          ? r.addons.map((a: any) => ({ name: String(a?.name || "Unnamed Addon"), price: Number(a?.price ?? 0) }))
          : Array.isArray(r?.addonDefs)
          ? r.addonDefs.map((a: any) => ({ name: String(a?.name || "Unnamed Addon"), price: Number(a?.price ?? 0) }))
          : [];

        const optionGroupsDefs: MenuOptionGroupDef[] = Array.isArray(r?.optionGroups)
          ? r.optionGroups.map((g: any) => ({
              groupId: String(g?.groupId || g?.id || ""),
              groupName: String(g?.groupName || g?.name || "Options"),
              type: (g?.type as any) || "single",
              items: Array.isArray(g?.items)
                ? g.items.map((it: any) => ({
                    id: String(it?.id || ""),
                    name: String(it?.name || "Item"),
                    priceDelta: Number(it?.priceDelta ?? 0),
                  }))
                : [],
            }))
          : Array.isArray(r?.options)
          ? r.options.map((g: any) => ({
              groupId: String(g?.groupId || g?.id || ""),
              groupName: String(g?.groupName || g?.name || "Options"),
              type: (g?.type as any) || "single",
              items: Array.isArray(g?.items)
                ? g.items.map((it: any) => ({
                    id: String(it?.id || ""),
                    name: String(it?.name || "Item"),
                    priceDelta: Number(it?.priceDelta ?? 0),
                  }))
                : [],
            }))
          : [];

        meta[d.id] = {
          id: d.id,
          name: r?.name,
          categoryId,
          subcategoryId,
          category: categoryId && catMap[categoryId] ? catMap[categoryId] : "Unknown",
          subcategory: subcategoryId && subMap[subcategoryId] ? subMap[subcategoryId] : "Unknown",
          addons: addonDefs,
          optionGroups: optionGroupsDefs,
        };
      }
      setMenuMeta(meta);
    } catch (e: any) {
      setError(e?.message || "Failed to load data.");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { if (fromStr && toStr) load(); /* eslint-disable-next-line */ }, [fromStr, toStr]);

  /** ===== Aggregations ===== */
  type ItemAgg = {
    id: string;
    name: string;
    category: string;
    subcategory: string;
    qty: number;
    orders: number;
    revenue: number;
  };
  const itemAggs: ItemAgg[] = useMemo(() => {
    const by: Record<string, ItemAgg> = {};
    for (const o of orders) {
      const lines = o.items || [];
      for (const ln of lines) {
        const id = ln.menuItemId || ln.menuItemName || "unknown";
        const meta = menuMeta[id] || {};
        const key = id;
        if (!by[key]) {
          by[key] = {
            id,
            name: ln.menuItemName || meta.name || "Unnamed",
            category: meta.category || "Unknown",
            subcategory: meta.subcategory || "Unknown",
            qty: 0,
            orders: 0,
            revenue: 0,
          };
        }
        const q = Number(ln.quantity || 0);
        const rev = Number(ln.lineTotal || 0);
        by[key].qty += q;
        by[key].orders += 1;
        by[key].revenue += rev;
      }
    }
    return Object.values(by);
  }, [orders, menuMeta]);

  // Top/Least
  const topGlobal = useMemo(
    () => [...itemAggs].sort((a,b) => b.qty - a.qty).slice(0, 10),
    [itemAggs]
  );
  const least = useMemo(
    () => [...itemAggs].sort((a,b) => a.qty - b.qty).slice(0, 10),
    [itemAggs]
  );

  // Top by Category
  const topByCategory = useMemo(() => {
    const byCat: Record<string, ItemAgg[]> = {};
    for (const it of itemAggs) {
      byCat[it.category] = byCat[it.category] || [];
      byCat[it.category].push(it);
    }
    const rows: { category: string; items: ItemAgg[] }[] = [];
    for (const [cat, arr] of Object.entries(byCat)) {
      rows.push({ category: cat, items: arr.sort((a,b)=> b.qty - a.qty).slice(0,10) });
    }
    return rows.sort((a,b)=> a.category.localeCompare(b.category));
  }, [itemAggs]);

  // Revenue by Category/Subcategory
  const revenueByCategory = useMemo(() => {
    const m = new Map<string, number>();
    for (const it of itemAggs) {
      m.set(it.category, (m.get(it.category) || 0) + it.revenue);
    }
    return Array.from(m.entries()).map(([category, revenue]) => ({ category, revenue }))
      .sort((a,b)=> b.revenue - a.revenue);
  }, [itemAggs]);

  const revenueBySubcategory = useMemo(() => {
    const m = new Map<string, number>();
    for (const it of itemAggs) {
      const key = `${it.category} / ${it.subcategory}`;
      m.set(key, (m.get(key) || 0) + it.revenue);
    }
    return Array.from(m.entries()).map(([subset, revenue]) => ({ subset, revenue }))
      .sort((a,b)=> b.revenue - a.revenue);
  }, [itemAggs]);

  // Impact: addons and option-groups (USADOS)
  type ExtraAgg = { label: string; count: number; revenue: number };
  const addonsAgg: ExtraAgg[] = useMemo(() => {
    const m = new Map<string, ExtraAgg>();
    for (const o of orders) {
      for (const ln of (o.items || [])) {
        for (const ad of (ln.addons || [])) {
          const label = ad.name || "Unnamed Addon";
          const revenue = Number(ad.price || 0) * Number(ln.quantity || 1);
          const cur = m.get(label) || { label, count: 0, revenue: 0 };
          cur.count += Number(ln.quantity || 1);
          cur.revenue += revenue;
          m.set(label, cur);
        }
      }
    }
    return Array.from(m.values()).sort((a,b)=> b.count - a.count);
  }, [orders]);

  const optionsAgg: ExtraAgg[] = useMemo(() => {
    const m = new Map<string, ExtraAgg>();
    for (const o of orders) {
      for (const ln of (o.items || [])) {
        for (const g of (ln.optionGroups || [])) {
          for (const it of g.items || []) {
            const label = `${g.groupName}: ${it.name}`;
            const revenue = Number(it.priceDelta || 0) * Number(ln.quantity || 1);
            const cur = m.get(label) || { label, count: 0, revenue: 0 };
            cur.count += Number(ln.quantity || 1);
            cur.revenue += revenue;
            m.set(label, cur);
          }
        }
      }
    }
    return Array.from(m.values()).sort((a,b)=> b.count - a.count);
  }, [orders]);

  // ====== DETECCIÓN DE NUNCA USADOS ======
  // Catálogo completo (labels)
  const catalogAddonLabels = useMemo(() => {
    const set = new Set<string>();
    Object.values(menuMeta).forEach((mi) => {
      (mi.addons || []).forEach((ad) => set.add(ad.name || "Unnamed Addon"));
    });
    return set;
  }, [menuMeta]);

  const catalogOptionItemLabels = useMemo(() => {
    const set = new Set<string>();
    Object.values(menuMeta).forEach((mi) => {
      (mi.optionGroups || []).forEach((g) => {
        (g.items || []).forEach((it) => {
          const label = `${g.groupName || "Options"}: ${it.name || "Item"}`;
          set.add(label);
        });
      });
    });
    return set;
  }, [menuMeta]);

  const usedAddonLabels = useMemo(() => new Set(addonsAgg.map(a => a.label)), [addonsAgg]);
  const usedOptionLabels = useMemo(() => new Set(optionsAgg.map(a => a.label)), [optionsAgg]);

  const neverUsedAddons = useMemo(() =>
    Array.from(catalogAddonLabels)
      .filter(lbl => !usedAddonLabels.has(lbl))
      .sort((a, b) => a.localeCompare(b)), [catalogAddonLabels, usedAddonLabels]);

  const neverUsedOptions = useMemo(() =>
    Array.from(catalogOptionItemLabels)
      .filter(lbl => !usedOptionLabels.has(lbl))
      .sort((a, b) => a.localeCompare(b)), [catalogOptionItemLabels, usedOptionLabels]);

  // ====== ITEMS NUNCA ORDENADOS ======
  const allMenuItemsList = useMemo(() => Object.values(menuMeta), [menuMeta]);
  const soldItemIds = useMemo(() => new Set(itemAggs.map(i => i.id)), [itemAggs]);
  const neverOrderedItems = useMemo(() => {
    return allMenuItemsList
      .filter(mi => !soldItemIds.has(mi.id))
      .map(mi => ({
        id: mi.id,
        name: mi.name || "Unnamed",
        category: mi.category || "Unknown",
        subcategory: mi.subcategory || "Unknown",
      }))
      .sort((a,b)=> a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  }, [allMenuItemsList, soldItemIds]);

  // Pies
  const pieByCategory: PieRow[] = useMemo(
    () => revenueByCategory.map(r => ({ label: r.category, value: r.revenue })),
    [revenueByCategory]
  );
  const pieBySubcategory: PieRow[] = useMemo(
    () => revenueBySubcategory.map(r => ({ label: r.subset, value: r.revenue })),
    [revenueBySubcategory]
  );
  const pieExtras: PieRow[] = useMemo(() => {
    const addonsTotal = addonsAgg.reduce((s,a)=> s+a.revenue, 0);
    const optionsTotal = optionsAgg.reduce((s,a)=> s+a.revenue, 0);
    return [
      { label: "Addons", value: addonsTotal },
      { label: "Option items", value: optionsTotal },
    ];
  }, [addonsAgg, optionsAgg]);

  // KPIs
  const totalOrders = orders.length;
  const totalRevenue = useMemo(
    () => orders.reduce((sum, o) => sum + getOrderRevenueUSD(o), 0),
    [orders]
  );

  /** ===== Excel Export (multi-tab) ===== */
  function onExportExcel() {
    const topGlobalSheet: Sheet = {
      name: "TopGlobal",
      headers: ["Item", "Category", "Subcategory", "Qty", "Orders", "Revenue (USD)"],
      rows: topGlobal.map(t => [t.name, t.category, t.subcategory, t.qty, t.orders, Number(t.revenue.toFixed(2))]),
    };
    const topByCatSheet: Sheet = {
      name: "TopByCategory",
      headers: ["Category", "Item", "Qty", "Orders", "Revenue (USD)"],
      rows: topByCategory.flatMap(grp =>
        grp.items.map(it => [grp.category, it.name, it.qty, it.orders, Number(it.revenue.toFixed(2))])
      ),
    };
    const leastSheet: Sheet = {
      name: "Least",
      headers: ["Item", "Category", "Subcategory", "Qty", "Orders", "Revenue (USD)"],
      rows: least.map(t => [t.name, t.category, t.subcategory, t.qty, t.orders, Number(t.revenue.toFixed(2))]),
    };
    const revCatSheet: Sheet = {
      name: "RevenueByCategory",
      headers: ["Category", "Revenue (USD)"],
      rows: revenueByCategory.map(r => [r.category, Number(r.revenue.toFixed(2))]),
    };
    const revSubSheet: Sheet = {
      name: "RevenueBySubcategory",
      headers: ["Category/Subcategory", "Revenue (USD)"],
      rows: revenueBySubcategory.map(r => [r.subset, Number(r.revenue.toFixed(2))]),
    };
    const addonsSheet: Sheet = {
      name: "AddonsImpact",
      headers: ["Addon", "Count (units)", "Revenue (USD)"],
      rows: addonsAgg.map(a => [a.label, a.count, Number(a.revenue.toFixed(2))]),
    };
    const optionsSheet: Sheet = {
      name: "OptionsImpact",
      headers: ["Option Item", "Count (units)", "Revenue (USD)"],
      rows: optionsAgg.map(a => [a.label, a.count, Number(a.revenue.toFixed(2))]),
    };
    const neverOrderedSheet: Sheet = {
      name: "NeverOrderedItems",
      headers: ["Item", "Category", "Subcategory"],
      rows: neverOrderedItems.map(n => [n.name, n.category, n.subcategory]),
    };
    const neverUsedAddonsSheet: Sheet = {
      name: "NeverUsedAddons",
      headers: ["Addon (catalog)"],
      rows: neverUsedAddons.map(lbl => [lbl]),
    };
    const neverUsedOptionsSheet: Sheet = {
      name: "NeverUsedOptions",
      headers: ["Option Item (catalog)"],
      rows: neverUsedOptions.map(lbl => [lbl]),
    };

    const xml = buildExcelXml([
      topGlobalSheet,
      topByCatSheet,
      leastSheet,
      revCatSheet,
      revSubSheet,
      addonsSheet,
      optionsSheet,
      neverOrderedSheet,
      neverUsedAddonsSheet,
      neverUsedOptionsSheet,
    ]);
    downloadExcelXml(`product_report_${fromStr}_to_${toStr}.xls`, xml);
  }

  return (
    <Protected>
      <AdminOnly>
        <main className="container py-4">
          <h1 className="h4 mb-3">Product Report</h1>

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
                    <button className="btn btn-primary flex-fill" onClick={load} disabled={loading}>
                      {loading ? "Loading…" : "Refresh"}
                    </button>
                    <button
                      className="btn btn-outline-success"
                      onClick={onExportExcel}
                      disabled={loading || orders.length === 0}
                      title="Export Excel with multiple tabs"
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
              <div className="card border-0 shadow-sm"><div className="card-body">
                <div className="text-muted small">Orders</div>
                <div className="h4 mb-0">{totalOrders}</div>
              </div></div>
            </div>
            <div className="col-12 col-md-3">
              <div className="card border-0 shadow-sm"><div className="card-body">
                <div className="text-muted small">Revenue</div>
                <div className="h4 mb-0">{money(totalRevenue)}</div>
              </div></div>
            </div>
            <div className="col-12 col-md-6">
            </div>
          </div>

          {/* Top / Least */}
          <div className="row g-3">
            <div className="col-12 col-lg-6">
              <div className="card border-0 shadow-sm h-100">
                <div className="card-header fw-semibold">Top 10 — Best Sellers (Global)</div>
                <div className="card-body p-0">
                  <table className="table mb-0">
                    <thead><tr>
                      <th>Item</th><th>Category</th><th>Subcategory</th>
                      <th className="text-end">Qty</th>
                      <th className="text-end">Orders</th>
                      <th className="text-end">Revenue</th>
                    </tr></thead>
                    <tbody>
                      {topGlobal.length === 0 && <tr><td colSpan={6} className="text-center text-muted">No data</td></tr>}
                      {topGlobal.map((r) => (
                        <tr key={r.id}>
                          <td>{r.name}</td>
                          <td>{r.category}</td>
                          <td>{r.subcategory}</td>
                          <td className="text-end">{r.qty}</td>
                          <td className="text-end">{r.orders}</td>
                          <td className="text-end">{money(r.revenue)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div className="col-12 col-lg-6">
              <div className="card border-0 shadow-sm h-100">
                <div className="card-header fw-semibold">Top 10 — Least Sellers</div>
                <div className="card-body p-0">
                  <table className="table mb-0">
                    <thead><tr>
                      <th>Item</th><th>Category</th><th>Subcategory</th>
                      <th className="text-end">Qty</th>
                      <th className="text-end">Orders</th>
                      <th className="text-end">Revenue</th>
                    </tr></thead>
                    <tbody>
                      {least.length === 0 && <tr><td colSpan={6} className="text-center text-muted">No data</td></tr>}
                      {least.map((r) => (
                        <tr key={r.id}>
                          <td>{r.name}</td>
                          <td>{r.category}</td>
                          <td>{r.subcategory}</td>
                          <td className="text-end">{r.qty}</td>
                          <td className="text-end">{r.orders}</td>
                          <td className="text-end">{money(r.revenue)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>

          {/* Top by Category */}
          <div className="card border-0 shadow-sm mt-3">
            <div className="card-header fw-semibold">Top 10 by Category</div>
            <div className="card-body p-0">
              <div className="table-responsive">
                <table className="table mb-0">
                  <thead><tr>
                    <th>Category</th><th>Item</th>
                    <th className="text-end">Qty</th>
                    <th className="text-end">Orders</th>
                    <th className="text-end">Revenue</th>
                  </tr></thead>
                  <tbody>
                    {topByCategory.length === 0 && <tr><td colSpan={5} className="text-center text-muted">No data</td></tr>}
                    {topByCategory.flatMap((grp) =>
                      grp.items.map((it) => (
                        <tr key={`${grp.category}-${it.id}`}>
                          <td>{grp.category}</td>
                          <td>{it.name}</td>
                          <td className="text-end">{it.qty}</td>
                          <td className="text-end">{it.orders}</td>
                          <td className="text-end">{money(it.revenue)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Revenue by Category/Subcategory + Extras Pie */}
          <div className="row g-3 mt-3">
            <div className="col-12 col-lg-4">
              <PieChart rows={pieByCategory} title="Revenue by Category (Pie)" currency />
            </div>
            <div className="col-12 col-lg-4">
              <PieChart rows={pieBySubcategory} title="Revenue by Subcategory (Pie)" currency />
            </div>
            <div className="col-12 col-lg-4">
              <PieChart rows={pieExtras} title="Extras Revenue (Pie: Addons vs Option items)" currency />
            </div>
          </div>

          {/* Impact tables: Addons & Options (usados) */}
          <div className="row g-3 mt-3">
            <div className="col-12 col-lg-6">
              <div className="card border-0 shadow-sm h-100">
                <div className="card-header fw-semibold">Addons Impact (Top)</div>
                <div className="card-body p-0">
                  <table className="table mb-0">
                    <thead><tr>
                      <th>Addon</th>
                      <th className="text-end">Units</th>
                      <th className="text-end">Revenue</th>
                    </tr></thead>
                    <tbody>
                      {addonsAgg.length === 0 && <tr><td colSpan={3} className="text-center text-muted">No data</td></tr>}
                      {addonsAgg.map((a) => (
                        <tr key={a.label}>
                          <td>{a.label}</td>
                          <td className="text-end">{a.count}</td>
                          <td className="text-end">{money(a.revenue)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div className="col-12 col-lg-6">
              <div className="card border-0 shadow-sm h-100">
                <div className="card-header fw-semibold">Option-Groups Impact (Top)</div>
                <div className="card-body p-0">
                  <table className="table mb-0">
                    <thead><tr>
                      <th>Option Item</th>
                      <th className="text-end">Units</th>
                      <th className="text-end">Revenue</th>
                    </tr></thead>
                    <tbody>
                      {optionsAgg.length === 0 && <tr><td colSpan={3} className="text-center text-muted">No data</td></tr>}
                      {optionsAgg.map((a) => (
                        <tr key={a.label}>
                          <td>{a.label}</td>
                          <td className="text-end">{a.count}</td>
                          <td className="text-end">{money(a.revenue)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>

          {/* NUEVO: Nunca ordenados + Nunca usados */}
          <div className="row g-3 mt-3">
            <div className="col-12">
              <div className="card border-0 shadow-sm">
                <div className="card-header fw-semibold">Menu Items — Never Ordered (in selected range)</div>
                <div className="card-body p-0">
                  <div className="table-responsive">
                    <table className="table mb-0">
                      <thead><tr>
                        <th>Item</th><th>Category</th><th>Subcategory</th>
                      </tr></thead>
                      <tbody>
                        {neverOrderedItems.length === 0 && (
                          <tr><td colSpan={3} className="text-center text-muted">No data</td></tr>
                        )}
                        {neverOrderedItems.map(mi => (
                          <tr key={mi.id}>
                            <td>{mi.name}</td>
                            <td>{mi.category}</td>
                            <td>{mi.subcategory}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>

            <div className="col-12 col-lg-6">
              <div className="card border-0 shadow-sm h-100">
                <div className="card-header fw-semibold">Catalog — Never Used Addons</div>
                <div className="card-body p-0">
                  <table className="table mb-0">
                    <thead><tr><th>Addon (name)</th></tr></thead>
                    <tbody>
                      {neverUsedAddons.length === 0 && (
                        <tr><td className="text-center text-muted">No data</td></tr>
                      )}
                      {neverUsedAddons.map((lbl) => (
                        <tr key={lbl}><td>{lbl}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div className="col-12 col-lg-6">
              <div className="card border-0 shadow-sm h-100">
                <div className="card-header fw-semibold">Catalog — Never Used Option Items</div>
                <div className="card-body p-0">
                  <table className="table mb-0">
                    <thead><tr><th>Option Item</th></tr></thead>
                    <tbody>
                      {neverUsedOptions.length === 0 && (
                        <tr><td className="text-center text-muted">No data</td></tr>
                      )}
                      {neverUsedOptions.map((lbl) => (
                        <tr key={lbl}><td>{lbl}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </main>
      </AdminOnly>
    </Protected>
  );
}
