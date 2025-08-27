// src/app/api/orders/[id]/route.ts
export const runtime = 'nodejs';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/firebase/admin';
import { getUserFromRequest } from '@/lib/server/auth';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await getUserFromRequest(_req);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const doc = await db.collection('orders').doc(params.id).get();
    if (!doc.exists) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const data = doc.data()!;
    const isAdmin = user.role === 'admin';
    if (!isAdmin && data.createdBy !== user.uid) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    return NextResponse.json({ id: doc.id, ...data });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await getUserFromRequest(req);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const ref = db.collection('orders').doc(params.id);
    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const data = snap.data()!;
    const isAdmin = user.role === 'admin';

    // Cliente solo cancela si es dueño y estado 'placed'
    if (!isAdmin) {
      if (data.createdBy !== user.uid) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      if (data.status !== 'placed') return NextResponse.json({ error: 'Only placed orders can be cancelled' }, { status: 409 });
    }

    await ref.update({ status: 'cancelled', updatedAt: new Date().toISOString() });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
