// src/app/api/orders/[id]/status/logs/route.ts
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/firebase/admin';
import { getUserFromRequest } from '@/lib/server/auth';

const json = (d: unknown, s = 200) => NextResponse.json(d, { status: s });

/**
 * GET /api/orders/:id/status/logs?limit=1
 * Devuelve los últimos N registros de status_log (por defecto 1).
 * Solo admin.
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await getUserFromRequest(req);
    if (!user) return json({ error: 'Unauthorized' }, 401);
    if (user.role !== 'admin') return json({ error: 'Forbidden' }, 403);

    const { searchParams } = new URL(req.url);
    const limit = Math.min(Number(searchParams.get('limit') ?? 1), 20);

    const orderRef = db.collection('orders').doc(params.id);
    const orderSnap = await orderRef.get();
    if (!orderSnap.exists) return json({ error: 'Not found' }, 404);

    const logsSnap = await orderRef
      .collection('status_log')
      .orderBy('at', 'desc')
      .limit(limit)
      .get();

    const items = logsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    return json({ items });
  } catch (e: any) {
    console.error('[GET /api/orders/:id/status/logs]', e);
    return json({ error: e?.message ?? 'Server error' }, 500);
  }
}
