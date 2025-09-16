// src/app/api/reports/tax/route.ts
import { NextRequest, NextResponse } from "next/server";
import * as admin from "firebase-admin";

/**
 * Bootstraps Firebase Admin (reuse your existing pattern)
 */
function ensureAdmin() {
  if (!admin.apps.length) {
    try {
      const json = process.env.FIREBASE_SERVICE_ACCOUNT_KEY_JSON;
      if (json) {
        admin.initializeApp({
          credential: admin.credential.cert(JSON.parse(json)),
        });
      } else {
        admin.initializeApp({
          credential: admin.credential.applicationDefault(),
        });
      }
    } catch (e) {
      console.error("[reports/tax] Error inicializando Admin SDK", e);
      throw new Error("No se pudo inicializar Firebase Admin");
    }
  }
  return admin.app();
}

type ReportType = "summary" | "vatbook" | "b2b";

type Filters = {
  start?: string; // ISO date (YYYY-MM-DD)
  end?: string;   // ISO date (YYYY-MM-DD)
  jurisdiction?: string;
  orderType?: "dine_in" | "pickup" | "delivery" | "";
  rateCode?: string;
  b2bOnly?: boolean;
};

type TaxSnapshot = {
  summaryByRate?: Array<{
    rateCode: string;
    ratePct?: number;
    taxableBaseCents?: number;
    taxAmountCents?: number;
  }>;
  summaryZeroRated?: { baseCents?: number } | null;
  summaryExempt?: { baseCents?: number } | null;
  surcharges?: Array<{
    code?: string;
    description?: string;
    taxable?: boolean;
    baseCents?: number;
    taxCents?: number;
    rateCode?: string | null;
    ratePct?: number | null;
  }>;
  currency?: string;
  jurisdictionApplied?: string | null;
};

type OrderDoc = {
  id?: string;
  createdAt?: admin.firestore.Timestamp | null;
  closedAt?: admin.firestore.Timestamp | null;
  status?: string;
  orderType?: "dine_in" | "pickup" | "delivery";
  customer?: { name?: string; taxId?: string | null } | null;
  totalCents?: number | null;
  taxSnapshot?: TaxSnapshot;
  // si usas invoiceNumber, lo tomamos (opcional)
  invoiceNumber?: string | null;
};

function parseDateRangeToTimestamps(start?: string, end?: string) {
  // Interpret inputs as local dates (00:00 inclusive to 23:59:59.999 exclusive next day)
  const startDate = start ? new Date(`${start}T00:00:00.000Z`) : null;
  const endDateExclusive = end
    ? new Date(new Date(`${end}T00:00:00.000Z`).getTime() + 24 * 60 * 60 * 1000)
    : null;
  return {
    startTs: startDate ? admin.firestore.Timestamp.fromDate(startDate) : null,
    endTs: endDateExclusive ? admin.firestore.Timestamp.fromDate(endDateExclusive) : null,
  };
}

function cents(n?: number | null) {
  return Number.isFinite(Number(n)) ? Number(n) : 0;
}

function add(a: number, b: number) {
  return a + b;
}

export async function POST(req: NextRequest) {
  try {
    ensureAdmin();
    const db = admin.firestore();

    const body = await req.json();
    const report: ReportType = body?.report || "summary";
    const filters: Filters = {
      start: body?.start,
      end: body?.end,
      jurisdiction: (body?.jurisdiction || "").trim(),
      orderType: body?.orderType || "",
      rateCode: (body?.rateCode || "").trim(),
      b2bOnly: !!body?.b2bOnly,
    };

    const { startTs, endTs } = parseDateRangeToTimestamps(filters.start, filters.end);

    // -------- Query base sobre orders --------
    // Por defecto tomamos órdenes "cerradas" (usualmente 'closed')
    // Ajusta el campo de fecha si prefieres closedAt en vez de createdAt.
    let q: FirebaseFirestore.Query = db.collection("orders");

    // Fechas
    if (startTs) q = q.where("createdAt", ">=", startTs);
    if (endTs) q = q.where("createdAt", "<", endTs);

    // Sólo cerradas (si quieres incluir paid, cámbialo a IN)
    q = q.where("status", "==", "closed");

    // Tipo de orden
    if (filters.orderType) {
      q = q.where("orderType", "==", filters.orderType);
    }

    // B2B (customer.taxId presente)
    if (filters.b2bOnly) {
      // Firestore no filtra por subcampo nulo vs presente fácilmente sin índices;
      // resolvemos filtrando en memoria tras la query (porque ya limitamos por fecha/estado).
      // También puedes llevar un flag booleano customer.isB2B en el doc para indexarlo.
    }

    const snap = await q.get();
    const orders: OrderDoc[] = [];
    snap.forEach((d) => {
      const data = d.data() as OrderDoc;
      data.id = d.id;
      orders.push(data);
    });

    // Filtros en memoria que requieren snapshot
    const filtered = orders.filter((o) => {
      // jurisdicción
      if (filters.jurisdiction) {
        const j = (o?.taxSnapshot?.jurisdictionApplied || "").toLowerCase();
        if (j !== filters.jurisdiction.toLowerCase()) return false;
      }
      // B2B
      if (filters.b2bOnly) {
        const hasTaxId = !!(o?.customer?.taxId && String(o.customer.taxId).trim());
        if (!hasTaxId) return false;
      }
      // rateCode (existencia en summaryByRate o en surcharges si taxable)
      if (filters.rateCode) {
        const rc = filters.rateCode.toLowerCase();
        const hitMain =
          o?.taxSnapshot?.summaryByRate?.some((r) => (r.rateCode || "").toLowerCase() === rc) ||
          false;
        const hitSurcharge =
          o?.taxSnapshot?.surcharges?.some(
            (s) => !!s.taxable && (s.rateCode || "").toLowerCase() === rc
          ) || false;
        if (!hitMain && !hitSurcharge) return false;
      }
      return true;
    });

    // --------- Aggregators comunes ---------
    type Key = string;

    // Summary por tasa (con breakdown por orderType + jurisdicción + columnas extra)
    const summaryMap = new Map<
      Key,
      {
        jurisdictionApplied: string;
        orderType: string;
        rateCode: string;
        ratePct: number;
        taxableBaseCents: number;
        taxCents: number;
        zeroRatedBaseCents: number;
        exemptBaseCents: number;
        serviceBaseCents: number;
        serviceTaxCents: number;
        currency: string;
      }
    >();

    // VAT Book (por jurisdicción y tasa) + zero/exempt
    const vatMap = new Map<
      Key,
      {
        jurisdictionApplied: string;
        rateCode: string;
        ratePct: number;
        taxableBaseCents: number;
        taxCents: number;
        zeroRatedBaseCents: number;
        exemptBaseCents: number;
        currency: string;
      }
    >();

    // B2B register (detalle por factura/orden)
    const b2bRows: Array<{
      date: string;
      orderId: string;
      invoiceNumber: string;
      customerName: string;
      customerTaxId: string;
      jurisdictionApplied: string;
      orderType: string;
      taxableBaseCents: number;
      taxCents: number;
      totalCents: number;
      currency: string;
    }> = [];

    for (const o of filtered) {
      const snapTax = o?.taxSnapshot || {};
      const curr = snapTax.currency || "USD";
      const jurisdiction = snapTax.jurisdictionApplied || "";
      const otype = o?.orderType || "";

      const zeroBase = cents(snapTax?.summaryZeroRated?.baseCents);
      const exBase = cents(snapTax?.summaryExempt?.baseCents);

      // ---- Summary por tasa (rate lines) ----
      const lines = snapTax.summaryByRate || [];
      // Surcharges (service charge)
      const surs = snapTax.surcharges || [];

      // Para B2B totales por orden: sumamos bases + impuestos “gravables” (no incluye zero/exempt)
      let orderTaxableBase = 0;
      let orderTax = 0;

      for (const r of lines) {
        const rc = (r.rateCode || "").trim();
        const rp = Number(r.ratePct ?? 0);
        const b = cents(r.taxableBaseCents);
        const t = cents(r.taxAmountCents);

        // summary
        {
          const key = [
            jurisdiction,
            otype,
            rc,
            rp.toFixed(6), // para evitar colisiones por float
            curr,
          ].join("|");
          const prev =
            summaryMap.get(key) ||
            {
              jurisdictionApplied: jurisdiction,
              orderType: otype,
              rateCode: rc,
              ratePct: rp,
              taxableBaseCents: 0,
              taxCents: 0,
              zeroRatedBaseCents: 0,
              exemptBaseCents: 0,
              serviceBaseCents: 0,
              serviceTaxCents: 0,
              currency: curr,
            };
          prev.taxableBaseCents += b;
          prev.taxCents += t;
          // zero/exempt se suman fuera del loop por línea para no duplicar por tasa
          summaryMap.set(key, prev);
        }

        // vat book
        {
          const key = [jurisdiction, rc, rp.toFixed(6), curr].join("|");
          const prev =
            vatMap.get(key) ||
            {
              jurisdictionApplied: jurisdiction,
              rateCode: rc,
              ratePct: rp,
              taxableBaseCents: 0,
              taxCents: 0,
              zeroRatedBaseCents: 0,
              exemptBaseCents: 0,
              currency: curr,
            };
          prev.taxableBaseCents += b;
          prev.taxCents += t;
          vatMap.set(key, prev);
        }

        orderTaxableBase += b;
        orderTax += t;
      }

      // service charges
      let serviceBase = 0;
      let serviceTax = 0;
      for (const s of surs) {
        if (s.taxable) {
          serviceBase += cents(s.baseCents);
          serviceTax += cents(s.taxCents);
          // Añade al summary y al vat con su propia rateCode si existe
          const rc = (s.rateCode || "").trim();
          const rp = Number(s.ratePct ?? 0);

          // summary (service sumado además a las columnas de service)
          {
            const key = [
              jurisdiction,
              otype,
              rc,
              rp.toFixed(6),
              curr,
            ].join("|");
            const prev =
              summaryMap.get(key) ||
              {
                jurisdictionApplied: jurisdiction,
                orderType: otype,
                rateCode: rc,
                ratePct: rp,
                taxableBaseCents: 0,
                taxCents: 0,
                zeroRatedBaseCents: 0,
                exemptBaseCents: 0,
                serviceBaseCents: 0,
                serviceTaxCents: 0,
                currency: curr,
              };
            prev.serviceBaseCents += cents(s.baseCents);
            prev.serviceTaxCents += cents(s.taxCents);
            summaryMap.set(key, prev);
          }

          // vat
          {
            const key = [jurisdiction, rc, rp.toFixed(6), curr].join("|");
            const prev =
              vatMap.get(key) ||
              {
                jurisdictionApplied: jurisdiction,
                rateCode: rc,
                ratePct: rp,
                taxableBaseCents: 0,
                taxCents: 0,
                zeroRatedBaseCents: 0,
                exemptBaseCents: 0,
                currency: curr,
              };
            prev.taxableBaseCents += cents(s.baseCents);
            prev.taxCents += cents(s.taxCents);
            vatMap.set(key, prev);
          }

          orderTaxableBase += cents(s.baseCents);
          orderTax += cents(s.taxCents);
        }
      }

      // Después de iterar líneas, asignamos a cada fila summary y vat los zero/exempt de la orden
      // Para summary: necesitamos distribuir zero/exempt por combinación (jurisdicción + otype + rate bucket).
      // Técnica: colocar zero/exempt en una fila "RATE=—" (rateCode vacío) para que aparezca una sola vez por channel.
      if (zeroBase || exBase) {
        const keySummaryZeroEx = [jurisdiction, otype, "", "0.000000", curr].join("|");
        const prev =
          summaryMap.get(keySummaryZeroEx) ||
          {
            jurisdictionApplied: jurisdiction,
            orderType: otype,
            rateCode: "",
            ratePct: 0,
            taxableBaseCents: 0,
            taxCents: 0,
            zeroRatedBaseCents: 0,
            exemptBaseCents: 0,
            serviceBaseCents: 0,
            serviceTaxCents: 0,
            currency: curr,
          };
        prev.zeroRatedBaseCents += zeroBase;
        prev.exemptBaseCents += exBase;
        summaryMap.set(keySummaryZeroEx, prev);
      }

      // En VAT book, agregamos filas especiales ZERO y EXEMPT por jurisdicción
      if (zeroBase) {
        const keyZero = [jurisdiction, "ZERO", "0.000000", curr].join("|");
        const prev =
          vatMap.get(keyZero) ||
          {
            jurisdictionApplied: jurisdiction,
            rateCode: "ZERO",
            ratePct: 0,
            taxableBaseCents: 0,
            taxCents: 0,
            zeroRatedBaseCents: 0,
            exemptBaseCents: 0,
            currency: curr,
          };
        prev.zeroRatedBaseCents += zeroBase;
        vatMap.set(keyZero, prev);
      }
      if (exBase) {
        const keyEx = [jurisdiction, "EXEMPT", "0.000000", curr].join("|");
        const prev =
          vatMap.get(keyEx) ||
          {
            jurisdictionApplied: jurisdiction,
            rateCode: "EXEMPT",
            ratePct: 0,
            taxableBaseCents: 0,
            taxCents: 0,
            zeroRatedBaseCents: 0,
            exemptBaseCents: 0,
            currency: curr,
          };
        prev.exemptBaseCents += exBase;
        vatMap.set(keyEx, prev);
      }

      // B2B rows
      const hasTaxId = !!(o?.customer?.taxId && String(o.customer.taxId).trim());
      if (hasTaxId) {
        const when = o.closedAt || o.createdAt;
        const dStr = when ? when.toDate().toISOString().slice(0, 10) : "";
        b2bRows.push({
          date: dStr,
          orderId: o.id || "",
          invoiceNumber: (o.invoiceNumber || "") + "",
          customerName: (o.customer?.name || "") + "",
          customerTaxId: (o.customer?.taxId || "") + "",
          jurisdictionApplied: jurisdiction,
          orderType: otype,
          taxableBaseCents: orderTaxableBase,
          taxCents: orderTax,
          totalCents: cents(o.totalCents),
          currency: curr,
        });
      }
    }

    // --- Respuestas por tipo ---
    if (report === "summary") {
      // Ordenamos por jurisdicción, orderType, rateCode
      const rows = Array.from(summaryMap.values()).sort((a, b) => {
        if (a.jurisdictionApplied !== b.jurisdictionApplied)
          return a.jurisdictionApplied.localeCompare(b.jurisdictionApplied);
        if (a.orderType !== b.orderType) return a.orderType.localeCompare(b.orderType);
        if (a.rateCode !== b.rateCode) return a.rateCode.localeCompare(b.rateCode);
        return a.ratePct - b.ratePct;
      });
      return NextResponse.json({ ok: true, rows });
    }

    if (report === "vatbook") {
      const rows = Array.from(vatMap.values()).sort((a, b) => {
        if (a.jurisdictionApplied !== b.jurisdictionApplied)
          return a.jurisdictionApplied.localeCompare(b.jurisdictionApplied);
        if (a.rateCode !== b.rateCode) return a.rateCode.localeCompare(b.rateCode);
        return a.ratePct - b.ratePct;
      });
      return NextResponse.json({ ok: true, rows });
    }

    if (report === "b2b") {
      const rows = b2bRows.sort((a, b) => {
        if (a.date !== b.date) return a.date.localeCompare(b.date);
        return a.orderId.localeCompare(b.orderId);
      });
      // Si pidieron sólo B2B ya filtramos antes; aquí devolvemos todos B2B encontrados
      return NextResponse.json({ ok: true, rows });
    }

    return NextResponse.json({ ok: false, error: "Unknown report type" }, { status: 400 });
  } catch (err: any) {
    console.error("[reports/tax] Error:", err);
    return NextResponse.json({ ok: false, error: String(err?.message || err) }, { status: 500 });
  }
}
