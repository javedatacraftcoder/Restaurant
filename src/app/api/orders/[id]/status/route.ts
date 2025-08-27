// src/app/api/orders/[id]/status/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/firebase/admin";
import { getUserFromRequest } from "@/lib/server/auth";
import { normalizeStatus, canTransition } from "@/lib/server/orders";
import type { OrderStatus } from "@/types/firestore";

const json = (d: unknown, s = 200) => NextResponse.json(d, { status: s });

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await getUserFromRequest(req);
    // asume auth hecha en middlewares/roles; si no, valida aquí

    if (!((req.headers.get("content-type") || "").includes("application/json"))) {
      return json({ error: "Content-Type must be application/json" }, 415);
    }

    const body = await req.json().catch(() => ({}));
    const requested = String(body?.nextStatus || "");
    if (!requested) return json({ error: "nextStatus is required" }, 400);

    let nextStatus: OrderStatus;
    try {
      nextStatus = normalizeStatus(requested);
    } catch (err: any) {
      return json({ error: err?.message || "Invalid status" }, 400);
    }

    // Cargar orden
    const ref = db.collection("orders").doc(params.id);
    const snap = await ref.get();
    if (!snap.exists) return json({ error: "Order not found" }, 404);

    const data = snap.data() as any;
    const currentStatus: OrderStatus = data?.status as OrderStatus;
    const type = (data?.type || "dine_in") as "dine_in" | "takeaway" | "delivery";

    if (!currentStatus) return json({ error: "Order has no current status" }, 500);

    if (!canTransition(currentStatus, nextStatus, type)) {
      // Mensaje con alias “bonito” también
      const pretty = (s: string) => s.replace(/_/g, " ");
      return json(
        {
          error: `Invalid transition: ${pretty(currentStatus)} → ${pretty(
            nextStatus
          )} (type=${type})`,
          invalid: true,
          from: currentStatus,
          to: nextStatus,
          type,
        },
        409
      );
    }

    await ref.update({
      status: nextStatus,
      updatedAt: new Date(),
      // si guardas un timeline:
      // history: FieldValue.arrayUnion({ at: FieldValue.serverTimestamp(), by: user?.uid, to: nextStatus })
    });

    const updated = await ref.get();
    return json({ ok: true, order: { id: ref.id, ...updated.data() } });
  } catch (e: any) {
    console.error("[PATCH /api/orders/:id/status]", e);
    return json({ error: e?.message ?? "Server error" }, 500);
  }
}
