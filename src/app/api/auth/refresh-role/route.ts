// src/app/api/auth/refresh-role/route.ts
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { adminAuth } from '@/lib/firebase/admin'; // <— usa esta si tu admin.ts exporta adminAuth

const OP_ROLES = new Set(['admin', 'kitchen', 'waiter', 'delivery', 'cashier']);

export async function POST(req: NextRequest) {
  const isProd = process.env.NODE_ENV === 'production';

  try {
    const authHeader = req.headers.get('authorization') ?? req.headers.get('Authorization');
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (!token) {
      return NextResponse.json({ ok: false, error: 'Missing Bearer token' }, { status: 401 });
    }

    // Verificar token con Admin SDK
    const decoded = await adminAuth.verifyIdToken(token);
    const customClaims = decoded as any;

    // Resolver rol
    let role: string = 'customer';
    if (typeof customClaims?.role === 'string' && OP_ROLES.has(customClaims.role)) {
      role = customClaims.role;
    } else {
      for (const r of OP_ROLES) {
        if (customClaims?.[r] === true) { role = r; break; }
      }
    }

    const res = NextResponse.json({ ok: true, role });

    // Cookies legibles por el middleware (no httpOnly) y con secure solo en prod
    res.cookies.set('appRole', role, {
      httpOnly: false,
      sameSite: 'lax',
      secure: isProd,
      path: '/',
      maxAge: 60 * 60 * 24 * 7,
    });

    res.cookies.set('isOp', String(OP_ROLES.has(role)), {
      httpOnly: false,
      sameSite: 'lax',
      secure: isProd,
      path: '/',
      maxAge: 60 * 60 * 24 * 7,
    });

    return res;
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || 'verifyIdToken failed' },
      { status: 401 }
    );
  }
}
