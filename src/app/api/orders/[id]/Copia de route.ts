// src/app/api/orders/[id]/route.ts
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/firebase/admin';
import { getUserFromRequest } from '@/lib/server/auth';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';

const json = (d: unknown, s = 200) => NextResponse.json(d, { status: s });

const EDITABLE_STATUS = new Set([
  'placed',
  'kitchen_in_progress',
  'kitchen_done',
  'ready_to_close',
]);

function isAdminOrWaiter(user: any) {
  const claims = user?.claims ?? {};
  const role = user?.role ?? claims?.role;
  return !!(claims?.admin || claims?.waiter || role === 'admin' || role === 'waiter');
}
function isAdmin(user: any) {
  const claims = user?.claims ?? {};
  const role = user?.role ?? claims?.role;
  return !!(claims?.admin || role === 'admin');
}

/** GET: devuelve la orden por id (requiere auth) */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {

  try {
    const user = await getUserFromRequest(req);
    if (!user) return json({ error: 'Unauthorized' }, 401);

    const ref = db.collection('orders').doc(params.id);
    const snap = await ref.get();
    if (!snap.exists) return json({ error: 'Not found' }, 404);

    const data = { id: snap.id, ...snap.data() };
    return json(data, 200);
  } catch (e) {
    console.error(e);
    return json({ error: 'Server error' }, 500);
  }
}

/**
 * PATCH: editar ítems/amounts/campos de una orden existente
 * - Auth obligatorio, rol admin o waiter
 * - Estado debe ser editable (no closed/cancelled)
 * Payload esperado (mismo shape que creación):
 * {
 *   items: [{ menuItemId, quantity, options:[{groupId, optionItemIds}], unitPriceCents? }],
 *   amounts: { subtotalCents, taxCents, serviceFeeCents, discountCents, tipCents, totalCents },
 *   currency, type, tableNumber, notes
 * }
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await getUserFromRequest(req);
    if (!user) return json({ error: 'Unauthorized' }, 401);
    if (!isAdminOrWaiter(user)) return json({ error: 'Forbidden' }, 403);

    const ref = db.collection('orders').doc(params.id);
    const snap = await ref.get();
    if (!snap.exists) return json({ error: 'Not found' }, 404);

    const current = snap.data()!;
    const curStatus = current.status;
    if (!EDITABLE_STATUS.has(curStatus)) {
      return json({ error: `status_not_editable:${curStatus}` }, 409);
    }

    const body = await req.json();

    // Normaliza items (OPS) y lines (legacy) para compatibilidad visual
    const items = Array.isArray(body.items)
      ? body.items.map((it: any) => ({
          menuItemId: it.menuItemId,
          name: it.name, // opcional
          quantity: Number(it.quantity ?? 1),
          unitPriceCents: Number(
            it.unitPriceCents ??
            it.priceCents ?? // por si llega con otro nombre
            0
          ),
          options: Array.isArray(it.options)
            ? it.options.map((og: any) => ({
                groupId: og.groupId,
                optionItemIds: Array.isArray(og.optionItemIds) ? og.optionItemIds : [],
              }))
            : [],
        }))
      : [];

    const legacyLines = items.map((it: any) => ({
      menuItemId: it.menuItemId,
      name: it.name,
      qty: it.quantity,
      unitPriceCents: it.unitPriceCents,
      selections: it.options?.map((og: any) => ({
        groupId: og.groupId,
        optionItemIds: og.optionItemIds,
      })) ?? [],
    }));

    // amounts: usa los del body si vienen; si no, conserva los actuales
    const amounts = body.amounts ?? current.amounts ?? null;

    const patch: any = {
      // Modelo OPS:
      items,
      amounts,
      currency: body.currency ?? current.currency ?? 'GTQ',
      type: body.type ?? current.type ?? 'dine_in',
      tableNumber: body.tableNumber ?? current.tableNumber ?? '',
      notes: body.notes ?? current.notes ?? '',

      // Compatibilidad legacy:
      lines: legacyLines,

      // serverTimestamp permitido en campo suelto
      updatedAt: FieldValue.serverTimestamp(),

      // Dentro de arrays NO se permite FieldValue.serverTimestamp():
      // usar Timestamp.now() para el log
      statusLogs: [
        ...(Array.isArray(current.statusLogs) ? current.statusLogs : []),
        {
          at: Timestamp.now(),
          by: (user as any)?.uid ?? 'system',
          type: 'edited_lines',
        },
      ],
    };

    await ref.update(patch);
    const updated = (await ref.get()).data();
    return json({ id: params.id, ...updated }, 200);
  } catch (e: any) {
    console.error(e);
    return json({ error: 'Server error', detail: String(e?.message ?? e) }, 500);
  }
}

/**
 * DELETE: cancelar orden
 * - Admin: puede cancelar siempre.
 * - Cliente: sólo si es el creador y estado = 'placed'.
 */
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await getUserFromRequest(req);
    if (!user) return json({ error: 'Unauthorized' }, 401);

    const ref = db.collection('orders').doc(params.id);
    const snap = await ref.get();
    if (!snap.exists) return json({ error: 'Not found' }, 404);

    const data = snap.data()!;
    const admin = isAdmin(user);

    if (!admin) {
      if (data.createdBy !== user.uid) return json({ error: 'Forbidden' }, 403);
      if (data.status !== 'placed') return json({ error: 'Only placed orders can be cancelled' }, 409);
    }

    // Opcional: loguear cancelación con Timestamp.now()
    await ref.update({
      status: 'cancelled',
      updatedAt: FieldValue.serverTimestamp(),
      statusLogs: [
        ...(Array.isArray(data.statusLogs) ? data.statusLogs : []),
        { at: Timestamp.now(), by: (user as any)?.uid ?? 'system', type: 'cancelled' },
      ],
    });

    return json({ ok: true }, 200);
  } catch (e) {
    console.error(e);
    return json({ error: 'Server error' }, 500);
  }
}
