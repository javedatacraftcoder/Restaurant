// src/app/api/orders/[id]/delivery/route.ts
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/firebase/admin';
import { getUserFromRequest } from '@/lib/server/auth';

/**
 * PATCH /api/orders/:id/delivery
 * Body: { courierName?: string, delivery?: 'pending'|'inroute'|'delivered' }
 * Actualiza subcampos dentro de orderInfo sin tocar el status principal.
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await getUserFromRequest(req);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = params;
    const body = await req.json().catch(() => ({} as any));
    const patch: { courierName?: string | null; delivery?: 'pending'|'inroute'|'delivered' } = {};

    if (typeof body?.courierName === 'string' && body.courierName.trim()) {
      patch.courierName = body.courierName.trim();
    }
    if (body?.delivery && ['pending', 'inroute', 'delivered'].includes(body.delivery)) {
      patch.delivery = body.delivery;
    }

    if (!Object.keys(patch).length) {
      return NextResponse.json({ error: 'No hay cambios válidos.' }, { status: 400 });
    }

    const ref = db.collection('orders').doc(id);
    await ref.set({ orderInfo: patch }, { merge: true });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error('PATCH /delivery error:', e);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
