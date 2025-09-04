// src/app/api/orders/[id]/status/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/firebase/admin";
import { getUserFromRequest } from "@/lib/server/auth";
import { normalizeStatus, canTransition } from "@/lib/server/orders";
import type { OrderStatus } from "@/types/firestore";

const json = (d: unknown, s = 200) => NextResponse.json(d, { status: s });

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> } // ⬅️ params ahora es Promise
) {
  try {
    // Autenticación (si tus middlewares ya validan roles, esto refuerza)
    const user = await getUserFromRequest(req);
    if (!user) return json({ error: "Unauthorized" }, 401);

    const { id } = await params; // ⬅️ se espera params antes de usar id
    if (!id) return json({ error: "Missing order id" }, 400);

    const body = await req.json().catch(() => null);
    const rawNext: string | undefined = body?.nextStatus;
    if (!rawNext || typeof rawNext !== "string") {
      return json({ error: "Missing nextStatus" }, 400);
    }

    // Normaliza al enum que usa el sistema (p. ej. camel/snake/alias → snake case)
    const nextStatus = normalizeStatus(rawNext) as OrderStatus | undefined;
    if (!nextStatus) {
      return json({ error: `Unknown status: ${rawNext}` }, 400);
    }

    // Carga de la orden
    const ref = db.collection("orders").doc(id);
    const snap = await ref.get();
    if (!snap.exists) return json({ error: "Order not found" }, 404);

    const data = snap.data() || {};
    const currentStatus = normalizeStatus(data.status) as OrderStatus | undefined;
    if (!currentStatus) return json({ error: "Order has no current status" }, 500);

    // Tipo de la orden para la matriz de transición (no tocar subestado delivery aquí)
    const type: "dine_in" | "takeaway" | "delivery" =
      (data?.type as any) ||
      (data?.orderInfo?.type === "dine-in" ? "dine_in" : data?.orderInfo?.type) ||
      "dine_in";

    // Si piden el mismo estado, es idempotente: devolvemos OK sin error
    if (currentStatus === nextStatus) {
      return json({ ok: true, order: { id: ref.id, ...data } });
    }

    // Valida transición (la lógica vive en lib/server/orders)
    if (!canTransition(currentStatus, nextStatus, type)) {
      const pretty = (s: string) => String(s || "").replace(/_/g, " ");
      return json(
        {
          error: `Invalid transition: ${pretty(currentStatus)} → ${pretty(nextStatus)} (type=${type})`,
          invalid: true,
          from: currentStatus,
          to: nextStatus,
          type,
        },
        400
      );
    }

    // Actualiza SOLO el estado principal (NO tocar orderInfo ni delivery aquí)
    await ref.update({
      status: nextStatus,
      updatedAt: new Date(),
      // Si manejas timeline/historial, puedes descomentar algo como:
      // history: FieldValue.arrayUnion({
      //   at: FieldValue.serverTimestamp(),
      //   by: user.uid,
      //   to: nextStatus,
      // }),
    });

    // Devuelve la orden actualizada
    const updated = await ref.get();
    return json({ ok: true, order: { id: ref.id, ...updated.data() } });
  } catch (e: any) {
    console.error("[PATCH /api/orders/:id/status] error:", e);
    return json({ error: e?.message ?? "Server error" }, 500);
  }
}
