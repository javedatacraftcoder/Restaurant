// src/app/api/orders/[id]/payment/route.ts
import { NextRequest, NextResponse } from "next/server";
import * as admin from "firebase-admin";

/** ========== Firebase Admin bootstrap ========== */
function getAdminApp() {
  if (!admin.apps.length) {
    const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
    // Si usas credenciales por variables de entorno (GCP/Emulator), esto basta:
    admin.initializeApp({ projectId });
  }
  return admin.app();
}
function db() {
  return getAdminApp().firestore();
}

/** ========== Auth helper (Bearer token) ========== */
async function verifyAuth(req: NextRequest) {
  const auth = req.headers.get("authorization") || req.headers.get("Authorization");
  if (!auth || !auth.startsWith("Bearer ")) return null;
  const token = auth.slice("Bearer ".length).trim();
  try {
    const decoded = await getAdminApp().auth().verifyIdToken(token);
    return decoded; // { uid, ...customClaims }
  } catch {
    return null;
  }
}

/** ========== PATCH /api/orders/:id/payment ==========
 * Body JSON (cualquiera de estos campos, todos opcionales):
 *  - status: string   (ej. "closed" | "paid" | "pending" | ...)
 *  - provider: string (ej. "cash" | "paypal" | "card")
 *  - amount: number
 *  - currency: string (ej. "USD")
 * Solo actualiza debajo de `payment.*` y `payment.updatedAt`.
 * ================================================ */
export async function PATCH(
  req: NextRequest,
  context: { params: { id: string } }
) {
  const decoded = await verifyAuth(req);
  if (!decoded) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Autorización mínima: admin o cashier
  const isAdmin = !!(decoded as any).admin;
  const isCashier = !!(decoded as any).cashier;
  if (!isAdmin && !isCashier) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = context.params;
  if (!id) {
    return NextResponse.json({ error: "Missing order id" }, { status: 400 });
  }

  let body: any = null;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const updates: Record<string, any> = {};
  if (typeof body?.status === "string" && body.status.trim() !== "") {
    updates["payment.status"] = String(body.status).trim();
  }
  if (typeof body?.provider === "string" && body.provider.trim() !== "") {
    updates["payment.provider"] = String(body.provider).trim();
  }
  if (Number.isFinite(Number(body?.amount))) {
    updates["payment.amount"] = Number(body.amount);
  }
  if (typeof body?.currency === "string" && body.currency.trim() !== "") {
    updates["payment.currency"] = String(body.currency).trim();
  }
  // Siempre marcamos updatedAt del bloque de payment
  updates["payment.updatedAt"] = admin.firestore.FieldValue.serverTimestamp();

  if (Object.keys(updates).length === 1) {
    // Solo trae updatedAt => no hay cambios útiles
    return NextResponse.json({ ok: false, reason: "No payment fields provided." }, { status: 400 });
  }

  // Idempotencia opcional por header (no estrictamente necesario)
  // const idemKey = req.headers.get("x-idempotency-key") || null;

  try {
    const ref = db().collection("orders").doc(id);
    // Validación básica: que exista la orden
    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    await ref.update(updates);

    // Devuelve el bloque payment resultante
    const after = await ref.get();
    const payment = (after.data() || {}).payment || null;

    return NextResponse.json({ ok: true, orderId: id, payment }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Update failed" }, { status: 500 });
  }
}

/** Opcional: rechazar otros métodos */
export async function GET() {
  return NextResponse.json({ error: "Method Not Allowed" }, { status: 405 });
}
export async function POST() {
  return NextResponse.json({ error: "Method Not Allowed" }, { status: 405 });
}
export async function PUT() {
  return NextResponse.json({ error: "Method Not Allowed" }, { status: 405 });
}
export async function DELETE() {
  return NextResponse.json({ error: "Method Not Allowed" }, { status: 405 });
}
