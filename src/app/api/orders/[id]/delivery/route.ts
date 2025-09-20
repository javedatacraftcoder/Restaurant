// src/app/api/orders/[id]/delivery/route.ts
import { NextRequest, NextResponse } from "next/server";
import * as admin from "firebase-admin";

// ---------------------------------------------------------------------------
// Bootstrap Admin
// ---------------------------------------------------------------------------
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
      console.error("[delivery] Error inicializando Admin SDK", e);
      throw new Error("No se pudo inicializar Firebase Admin");
    }
  }
  return admin.app();
}

type DeliverySubState = "pending" | "inroute" | "delivered";

type PatchBody = {
  courierName?: string | null;
  delivery?: DeliverySubState;
};

// Utilidad para roles básicos
function hasRole(decoded: admin.auth.DecodedIdToken, ...roles: string[]) {
  const r = (decoded as any).role;
  const rs: string[] = (decoded as any).roles || [];
  return roles.some((x) => r === x || rs.includes(x));
}

// ---------------------------------------------------------------------------
// PATCH /api/orders/[id]/delivery
// ---------------------------------------------------------------------------
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const app = ensureAdmin();
    const db = app.firestore();

    // ---------- Auth ----------
    const authHeader = req.headers.get("authorization") ?? "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let decoded: admin.auth.DecodedIdToken;
    try {
      decoded = await app.auth().verifyIdToken(token);
    } catch {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Permite admin y personal de delivery (ajusta a tu modelo de roles)
    if (!hasRole(decoded, "admin", "delivery")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // ---------- Params / Body ----------
    const orderId = params?.id;
    if (!orderId) {
      return NextResponse.json({ error: "Missing order id" }, { status: 400 });
    }

    let payload: PatchBody;
    try {
      payload = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { courierName, delivery } = payload;
    if (courierName == null && delivery == null) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }

    const orderRef = db.collection("orders").doc(orderId);

    // Sentinel para campos escalares (no dentro de arrays)
    const nowTS = admin.firestore.FieldValue.serverTimestamp();
    // Timestamp concreto para usar dentro de arrayUnion (no se permite serverTimestamp allí)
    const now = admin.firestore.Timestamp.now();

    const result = await db.runTransaction(async (tx) => {
      const snap = await tx.get(orderRef);
      if (!snap.exists) {
        throw new Error("Order not found");
      }

      const data = snap.data() || {};
      const orderInfo = { ...(data.orderInfo || {}) };
      const prevSub: DeliverySubState | undefined = orderInfo.delivery;
      const timeline = { ...(orderInfo.deliveryTimeline || {}) };

      const updates: Record<string, any> = {};
      const eventsToAdd: any[] = [];

      // 1) courierName (si cambia)
      if (typeof courierName !== "undefined") {
        const newName = (courierName ?? null) as string | null;
        if ((orderInfo.courierName ?? null) !== newName) {
          updates["orderInfo.courierName"] = newName;
          // Opcional: si no hay pendingAt aún, sellarlo al asignar repartidor
          if (!timeline.pendingAt) {
            updates["orderInfo.deliveryTimeline.pendingAt"] = nowTS;
          }
        }
      }

      // 2) delivery sub-state (si cambia)
      if (delivery && delivery !== prevSub) {
        updates["orderInfo.delivery"] = delivery;

        // Sella timestamps solo si aún no existen (idempotente)
        if (delivery === "pending" && !timeline.pendingAt) {
          updates["orderInfo.deliveryTimeline.pendingAt"] = nowTS;
        }
        if (delivery === "inroute" && !timeline.inrouteAt) {
          if (!timeline.pendingAt) {
            updates["orderInfo.deliveryTimeline.pendingAt"] = nowTS;
          }
          updates["orderInfo.deliveryTimeline.inrouteAt"] = nowTS;
        }
        if (delivery === "delivered" && !timeline.deliveredAt) {
          if (!timeline.pendingAt) {
            updates["orderInfo.deliveryTimeline.pendingAt"] = nowTS;
          }
          if (!timeline.inrouteAt) {
            updates["orderInfo.deliveryTimeline.inrouteAt"] = nowTS;
          }
          updates["orderInfo.deliveryTimeline.deliveredAt"] = nowTS;
        }

        // Bitácora de eventos (usa Timestamp.now() dentro del array)
        eventsToAdd.push({
          state: delivery,
          by: decoded.uid,
          courierName:
            typeof courierName !== "undefined"
              ? (courierName ?? null)
              : (orderInfo.courierName ?? null),
          at: now, // <- NO usar serverTimestamp() dentro de arrayUnion
        });
      }

      // 3) Si solo se asignó courierName y no había pendingAt, sella pendingAt
      if (typeof courierName !== "undefined" && !timeline.pendingAt) {
        updates["orderInfo.deliveryTimeline.pendingAt"] = nowTS;
      }

      if (eventsToAdd.length) {
        updates["orderInfo.deliveryEvents"] =
          admin.firestore.FieldValue.arrayUnion(...eventsToAdd);
      }

      if (Object.keys(updates).length === 0) {
        return { ok: true, unchanged: true, id: orderId };
      }

      tx.update(orderRef, updates);
      return { ok: true, id: orderId, updates };
    });

    return NextResponse.json(result, { status: 200 });
  } catch (e: any) {
    console.error("[delivery] PATCH error:", e);
    const msg = e?.message || "Server error";
    const code = /not found/i.test(msg) ? 404 : 500;
    return NextResponse.json({ error: msg }, { status: code });
  }
}
