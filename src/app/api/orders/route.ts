// src/app/api/orders/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/firebase/admin";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { getUserFromRequest } from "@/lib/server/auth";

const json = (d: unknown, s = 200) => NextResponse.json(d, { status: s });

type OrderType = "dine_in" | "takeaway" | "delivery";

type LineInput = {
  itemId: string;
  name: string;
  qty: number;
  unitPriceCents: number;
  totalCents: number;
};

type CreateOrderBody = {
  type: OrderType;
  // formato OPS
  items?: Array<{
    menuItemId: string;
    menuItemName?: string;
    quantity: number;
    options?: Array<{ groupName: string; selected: Array<{ name: string; priceDelta: number }> }>;
  }>;
  amounts?: { subtotal: number; tax?: number; serviceFee?: number; discount?: number; tip?: number; total: number };
  tableNumber?: string;
  notes?: string;
  currency?: string;
  meta?: Record<string, any>;
  deliveryAddress?: string;
  contactPhone?: string;

  // compat legacy
  lines?: any;
  cart?: any;
  orderLines?: any;
};

function isOrderType(v: any): v is OrderType {
  return v === "dine_in" || v === "takeaway" || v === "delivery";
}

/* -------------------- POST: crear orden -------------------- */
export async function POST(req: NextRequest) {
  try {
    if (!((req.headers.get("content-type") || "").includes("application/json"))) {
      return json({ error: "Content-Type must be application/json" }, 415);
    }

    const body = (await req.json().catch(() => ({}))) as CreateOrderBody;
    const type = body?.type;
    if (!isOrderType(type)) {
      return json({ error: "Invalid or missing 'type'" }, 400);
    }

    const user = await getUserFromRequest(req).catch(() => null);

    // ──────────────────────────────────────────────────────────────────────
    // 1) Formato NUEVO (OPS): items + amounts + (tableNumber, notes, currency)
    // ──────────────────────────────────────────────────────────────────────
    if (Array.isArray(body.items) && body.items.length > 0 && body.amounts) {
      const items = body.items.map((it) => ({
        menuItemId: String(it.menuItemId),
        menuItemName: String(it.menuItemName ?? ""),
        quantity: Number(it.quantity || 1),
        options: Array.isArray(it.options) ? it.options : [],
      }));

      const amounts = {
        subtotal: Number(body.amounts.subtotal || 0),
        tax: Number(body.amounts.tax || 0),
        serviceFee: Number(body.amounts.serviceFee || 0),
        discount: Number(body.amounts.discount || 0),
        tip: Number(body.amounts.tip || 0),
        total: Number(body.amounts.total || 0),
      };

      const currency = (body.currency || "GTQ").toUpperCase();
      const tableNumber = typeof body.tableNumber === "string" ? body.tableNumber.trim() : "";
      const notes = typeof body.notes === "string" ? body.notes.trim() : "";

      if (type === "dine_in" && !tableNumber) {
        return json({ error: "Para Dine-In se requiere número de mesa." }, 400);
      }
      if (!Number.isFinite(amounts.total) || amounts.total <= 0) {
        return json({ error: "Montos inválidos o total = 0." }, 400);
      }

      const now = FieldValue.serverTimestamp();
      const orderDoc: Record<string, any> = {
        type,
        status: "placed",
        items,           // ← OPS lee items con addons
        amounts,         // ← totales en Q
        currency,        // ← por defecto GTQ
        tableNumber: tableNumber || null,
        notes: notes || null,
        meta: body.meta || {},
        deliveryAddress: body.deliveryAddress || null,
        contactPhone: body.contactPhone || null,
        createdAt: now,
        updatedAt: now,
        createdBy: user?.uid ? { uid: user.uid } : null,
        channel: type === "delivery" ? "delivery" : "onsite",
        origin: "web",
      };

      const ref = await db.collection("orders").add(orderDoc);
      await db.collection("orders").doc(ref.id).collection("events").add({
        type: "order_created",
        at: FieldValue.serverTimestamp(),
        by: orderDoc.createdBy,
        payload: { status: "placed" },
      });

      const snap = await ref.get();
      return json({ ok: true, order: { id: ref.id, ...snap.data() } }, 201);
    }

    // ──────────────────────────────────────────────────────────────────────
    // 2) Formato LEGACY (compat): lines/orderLines/cart/items "planos"
    // ──────────────────────────────────────────────────────────────────────
    const linesRaw =
      (Array.isArray(body.lines) && body.lines) ||
      (Array.isArray(body.items) && body.items) ||
      (Array.isArray(body.cart) && body.cart) ||
      (Array.isArray(body.orderLines) && body.orderLines) ||
      [];

    if (!linesRaw.length) return json({ error: "No lines provided" }, 400);

    if (type === "delivery" && !user) {
      return json({ error: "Auth required for delivery orders" }, 401);
    }

    // normaliza líneas mínimas
    const safeLines = linesRaw.map((l: any) => {
      const qty = Number(l?.qty ?? l?.quantity ?? 1);
      const unit = Number(l?.unitPriceCents ?? l?.unit_cents ?? 0);
      const tot = Number(
        l?.totalCents ?? l?.total_cents ?? (Number.isFinite(unit) ? unit * qty : 0)
      );
      return {
        itemId: String(l?.itemId ?? l?.menuItemId ?? l?.id),
        name: String(l?.name ?? l?.menuItemName ?? ""),
        qty: qty > 0 ? qty : 1,
        unitPriceCents: Number.isFinite(unit) ? unit : 0,
        totalCents: Number.isFinite(tot) ? tot : 0,
      } as LineInput;
    });

    const totalCents = safeLines.reduce((acc: number, l: any) => acc + (l.totalCents || 0), 0);

    const now = FieldValue.serverTimestamp();
    const orderDocLegacy: Record<string, any> = {
      type,
      status: "placed",
      lines: safeLines,
      totals: { totalCents },
      createdAt: now,
      updatedAt: now,
      createdBy: user?.uid ? { uid: user.uid } : null,
      origin: "web",
    };

    const ref = await db.collection("orders").add(orderDocLegacy);
    const snap = await ref.get();
    return json({ ok: true, order: { id: ref.id, ...snap.data() } }, 201);
  } catch (e: any) {
    console.error("[POST /api/orders]", e);
    return json({ error: e?.message ?? "Server error" }, 500);
  }
}

/* -------------------- GET: listar con filtros -------------------- */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const limitParam = parseInt(searchParams.get("limit") || "50", 10);
    const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 200) : 50;

    const statusInParam = (searchParams.get("statusIn") || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const typeInParam = (searchParams.get("typeIn") || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean) as OrderType[];

    const defaultTypes: OrderType[] = ["dine_in", "takeaway", "delivery"];
    const typesToUse: OrderType[] =
      typeInParam.length > 0
        ? (typeInParam.filter(isOrderType) as OrderType[])
        : defaultTypes;

    let q: FirebaseFirestore.Query<FirebaseFirestore.DocumentData> = db.collection("orders");

    let hasFilter = false;

    if (statusInParam.length === 1) {
      q = q.where("status", "==", statusInParam[0]);
      hasFilter = true;
    } else if (statusInParam.length > 1 && statusInParam.length <= 10) {
      q = q.where("status", "in", statusInParam);
      hasFilter = true;
    }

    if (typesToUse.length === 1) {
      q = q.where("type", "==", typesToUse[0]);
      hasFilter = true;
    } else if (typesToUse.length > 1 && typesToUse.length <= 10) {
      q = q.where("type", "in", typesToUse);
      hasFilter = true;
    }

    // ⚠️ Si hay filtros, no usar orderBy para evitar índice compuesto
    if (!hasFilter) {
      q = q.orderBy("createdAt", "desc");
    }

    q = q.limit(limit);

    const snap = await q.get();
    let orders = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    // Ordenar en servidor por createdAt desc cuando hubo filtros (sin usar index)
    if (hasFilter) {
      orders.sort((a: any, b: any) => {
        const ta = (a.createdAt instanceof Timestamp) ? a.createdAt.toMillis() : (a.createdAt?._seconds ? a.createdAt._seconds * 1000 : 0);
        const tb = (b.createdAt instanceof Timestamp) ? b.createdAt.toMillis() : (b.createdAt?._seconds ? b.createdAt._seconds * 1000 : 0);
        return tb - ta;
      });
    }

    return json({ ok: true, orders }, 200);
  } catch (e: any) {
    console.error("[GET /api/orders]", e);
    return json({ error: e?.message ?? "Server error" }, 500);
  }
}

/* -------------------- OPTIONS -------------------- */
export function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Max-Age": "86400",
    },
  });
}
