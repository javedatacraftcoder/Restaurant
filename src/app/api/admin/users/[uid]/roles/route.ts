// src/app/api/admin/users/[uid]/roles/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { adminAuth } from '@/lib/firebase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getBearerToken(req: NextRequest) {
  const h = req.headers.get('authorization') || '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
}

const ALLOWED_KEYS = ['admin', 'kitchen', 'waiter', 'delivery', 'cashier'] as const;
type RoleKey = typeof ALLOWED_KEYS[number];

export async function PATCH(
  req: NextRequest,
  { params }: { params: { uid: string } }
) {
  try {
    const token = getBearerToken(req);
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const decoded = await adminAuth.verifyIdToken(token);
    if (!decoded?.admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const uid = params?.uid;
    if (!uid) return NextResponse.json({ error: 'Missing uid' }, { status: 400 });

    const body = await req.json().catch(() => ({}));
    const nextClaims: Partial<Record<RoleKey, boolean>> = {};
    for (const k of ALLOWED_KEYS) {
      if (typeof body[k] === 'boolean') nextClaims[k] = !!body[k];
    }
    if (Object.keys(nextClaims).length === 0) {
      return NextResponse.json({ error: 'No role fields provided' }, { status: 400 });
    }

    const user = await adminAuth.getUser(uid);
    const current = (user.customClaims || {}) as Record<string, any>;
    const merged = { ...current, ...nextClaims };

    await adminAuth.setCustomUserClaims(uid, merged);

    return NextResponse.json({
      ok: true,
      claims: merged,
      note: 'El usuario debe renovar sesión o refrescar su ID token para ver los cambios.',
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Internal error' }, { status: 500 });
  }
}
