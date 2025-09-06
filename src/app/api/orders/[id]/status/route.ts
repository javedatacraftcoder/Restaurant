// src/app/api/orders/[id]/status/route.ts
import { NextRequest, NextResponse } from 'next/server';
import * as admin from 'firebase-admin';

/** ---------- Bootstrap Admin SDK (idempotente) ---------- */
function getAdminApp() {
  if (!admin.apps.length) {
    admin.initializeApp({
      // Si ya inicializas con GOOGLE_APPLICATION_CREDENTIALS, esto es suficiente
      credential: admin.credential.applicationDefault(),
    });
  }
  return admin.app();
}
function getDb() { return getAdminApp().firestore(); }

/** ---------- Helpers de Auth/Roles ---------- */
async function getUserFromAuthHeader(req: NextRequest) {
  const hdr = req.headers.get('authorization') || req.headers.get('Authorization');
  if (!hdr || !hdr.toLowerCase().startsWith('bearer ')) return null;
  const token = hdr.slice(7).trim();
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    return decoded; // { uid, email, ...custom claims }
  } catch {
    return null;
  }
}
function hasRole(claims: any, role: string) {
  return !!(claims && (claims[role] || (Array.isArray(claims.roles) && claims.roles.includes(role))));
}
function canOperate(claims: any) {
  return hasRole(claims, 'admin') || hasRole(claims, 'kitchen') || hasRole(claims, 'cashier') || hasRole(claims, 'delivery');
}

/** ---------- Flujos permitidos ---------- */
const FLOW_DINE_IN = ['placed', 'kitchen_in_progress', 'kitchen_done', 'ready_to_close', 'closed'] as const;
const FLOW_DELIVERY = ['placed', 'kitchen_in_progress', 'kitchen_done', 'assigned_to_courier', 'on_the_way', 'delivered', 'closed'] as const;
type StatusSnake = (typeof FLOW_DINE_IN[number]) | (typeof FLOW_DELIVERY[number]) | 'cart' | 'cancelled';

/** ✅ NUEVO: normalizar el tipo operativo (pickup → dine_in) */
function normalizeOperationalType(order: any): 'dine_in' | 'delivery' {
  const raw = String(order?.orderInfo?.type || order?.type || '').toLowerCase();
  if (raw === 'delivery') return 'delivery';
  // 'pickup' y cualquier otro caen a flujo de salón
  return 'dine_in';
}
function flowFor(t: 'dine_in' | 'delivery') {
  return t === 'delivery' ? FLOW_DELIVERY : FLOW_DINE_IN;
}

/** ---------- GET actual de orden (si necesitas en otras ramas) ---------- */
async function readOrder(docId: string) {
  const snap = await getDb().collection('orders').doc(docId).get();
  if (!snap.exists) return null;
  return { id: snap.id, ...snap.data() };
}

/** ---------- PATCH: cambiar estado ---------- */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await getUserFromAuthHeader(req);
    if (!user || !canOperate(user)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const id = params.id;
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

    let body: any;
    try { body = await req.json(); } catch { body = {}; }
    const nextStatus = String(body?.nextStatus || '').trim() as StatusSnake;
    if (!nextStatus) return NextResponse.json({ error: 'Missing nextStatus' }, { status: 400 });

    const db = getDb();
    const ref = db.collection('orders').doc(id);

    // Usamos transacción para validar y escribir atomícamente
    const result = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new Error('Order not found');
      const order: any = { id: snap.id, ...snap.data() };

      const currentStatus = String(order.status || 'placed') as StatusSnake;

      // ✅ NUEVO: usar flujo operativo (pickup → dine_in)
      const typeForFlow = normalizeOperationalType(order);
      const allowed = flowFor(typeForFlow);

      // Validaciones de transición (permite 1 paso hacia adelante; opcional: 1 paso atrás)
      const curIdx = allowed.indexOf(currentStatus as any);
      const nxtIdx = allowed.indexOf(nextStatus as any);

      // Permitir avanzar un paso o retroceder exactamente un paso (si lo usas en Kitchen)
      const isForward = curIdx >= 0 && nxtIdx === curIdx + 1;
      const isBackward = curIdx >= 0 && nxtIdx === curIdx - 1;

      if (!isForward && !isBackward) {
        throw new Error(`Invalid transition: ${currentStatus} → ${nextStatus} (type=${order?.orderInfo?.type || order?.type || 'unknown'})`);
      }

      // Status history (append)
      const hist = Array.isArray(order.statusHistory) ? order.statusHistory.slice() : [];
      hist.push({
        at: new Date().toISOString(),
        by: user.uid || null,
        from: currentStatus,
        to: nextStatus,
      });

      tx.update(ref, {
        status: nextStatus,
        statusHistory: hist,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      return { ok: true, id, from: currentStatus, to: nextStatus };
    });

    return NextResponse.json(result, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Error' }, { status: 400 });
  }
}

/** (Opcional) HEAD/OPTIONS si ya los exponías */
export async function OPTIONS() {
  return NextResponse.json({ ok: true });
}
