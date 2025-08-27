// src/app/api/admin/users/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { adminAuth } from '@/lib/firebase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getBearerToken(req: NextRequest) {
  const h = req.headers.get('authorization') || '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
}

export async function GET(req: NextRequest) {
  try {
    const token = getBearerToken(req);
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const decoded = await adminAuth.verifyIdToken(token);
    if (!decoded?.admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const { searchParams } = new URL(req.url);
    const limitParam = Number(searchParams.get('limit') || 50);
    const limit = Math.min(Math.max(1, limitParam), 1000);

    const list = await adminAuth.listUsers(limit);
    const users = list.users.map((u) => ({
      uid: u.uid,
      email: u.email,
      displayName: u.displayName,
      disabled: u.disabled,
      claims: u.customClaims || {},
      metadata: {
        creationTime: u.metadata?.creationTime,
        lastSignInTime: u.metadata?.lastSignInTime,
      },
    }));

    return NextResponse.json({ users });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Internal error' }, { status: 500 });
  }
}
