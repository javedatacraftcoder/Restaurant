// src/app/api/tx/order-delivered/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/firebase/admin";
import { getUserFromRequest } from "@/lib/server/auth";
import { sendTransactionalEmail } from "@/lib/email/brevoTx";
import { orderDeliveredHtml, orderDeliveredText } from "@/lib/email/orderDeliveredTemplate";

const json = (d: unknown, s = 200) => NextResponse.json(d, { status: s });

type OrderDoc = any;

function isDeliveryOrder(o: OrderDoc) {
  const t = o?.orderInfo?.type?.toLowerCase?.();
  if (t) return t === "delivery";
  // Fallbacks antiguos por si tu data legacy los usa:
  return !!(o?.orderInfo?.address || o?.deliveryAddress || o?.type === "delivery");
}

// ✅ SOLO usamos orderInfo.delivery para confirmar “delivered”
function isDelivered(o: OrderDoc) {
  const oi = String(o?.orderInfo?.delivery || "").toLowerCase();
  return oi === "delivered";
}

function getRecipientEmail(o: OrderDoc): string | null {
  return (
    (o?.createdBy?.email && String(o.createdBy.email)) ||
    (o?.userEmail && String(o.userEmail)) ||
    (o?.userEmail_lower && String(o.userEmail_lower)) ||
    null
  );
}

function getCustomerName(o: OrderDoc): string | undefined {
  return o?.orderInfo?.customerName || undefined;
}

export async function POST(req: NextRequest) {
  try {
    // Autorización: admin, delivery o cashier
    const me: any = await getUserFromRequest(req);
    if (!me) return json({ error: "Unauthorized" }, 401);
    const role = me?.role || "";
    const isAllowed = me?.admin === true || ["admin", "delivery", "cashier"].includes(role);
    if (!isAllowed) return json({ error: "Forbidden" }, 403);

    // orderId por query o body
    const url = new URL(req.url);
    const idFromQuery = url.searchParams.get("id");
    const body = await req.json().catch(() => ({} as any));
    const orderId = String(body?.orderId || idFromQuery || "").trim();
    if (!orderId) return json({ error: "Missing orderId" }, 400);

    // Cargar orden
    const ref = db.collection("orders").doc(orderId);
    const snap = await ref.get();
    if (!snap.exists) return json({ error: "Order not found" }, 404);
    const order = { id: snap.id, ...(snap.data() || {}) } as OrderDoc;

    // Debe ser delivery
    if (!isDeliveryOrder(order)) {
      return json({ ok: true, skipped: true, reason: "Not a delivery order" }, 200);
    }

    // ✅ Debe estar delivered SOLO por orderInfo.delivery
    if (!isDelivered(order)) {
      return json({ ok: true, skipped: true, reason: "Order is not delivered yet (orderInfo.delivery !== 'delivered')" }, 200);
    }

    // Idempotencia
    const tx = (order as any).tx || {};
    if (tx?.deliveredEmailSentAt) {
      return json({ ok: true, alreadySent: true, at: tx.deliveredEmailSentAt }, 200);
    }

    // Destinatario
    let toEmail = getRecipientEmail(order);
    if (!toEmail && order?.createdBy?.uid) {
      const cSnap = await db.collection("customers").doc(String(order.createdBy.uid)).get();
      if (cSnap.exists) {
        const c = cSnap.data() as any;
        if (c?.email) toEmail = String(c.email);
      }
    }
    if (!toEmail) return json({ error: "No recipient email found for this order" }, 400);

    const displayName = getCustomerName(order) || undefined;

    // Render template
    const html = orderDeliveredHtml(order);
    const text = orderDeliveredText(order);
    const subject = `Your order has been delivered — #${order.orderNumber || order.id}`;

    // Enviar
    const { messageId } = await sendTransactionalEmail({
      toEmail: toEmail,
      toName: displayName,
      subject,
      html,
      text,
    });

    // Marcar idempotencia
    const patch = {
      tx: {
        ...(tx || {}),
        deliveredEmailSentAt: new Date(),
        deliveredMessageId: messageId || null,
      },
      updatedAt: new Date(),
    };
    await ref.set(patch, { merge: true });

    return json({ ok: true, orderId, messageId });
  } catch (e: any) {
    console.error("[POST /api/tx/order-delivered] error:", e);
    return json({ error: e?.message || "Server error" }, 500);
  }
}
