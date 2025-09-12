import { NextResponse } from 'next/server';
import * as admin from 'firebase-admin';

export const runtime = 'nodejs';

function ensureAdmin() {
  if (!admin.apps.length) {
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
  }
  return admin.app();
}

function toJsDate(x: any): Date | null {
  if (!x) return null;
  if (typeof x?.toDate === 'function') {
    try { return x.toDate(); } catch { return null; }
  }
  const d = new Date(x);
  return isNaN(d.getTime()) ? null : d;
}

export async function GET() {
  try {
    ensureAdmin();
    const db = admin.firestore();

    // Leemos todas las activas (filtrado adicional por vigencia en el servidor)
    const snap = await db.collection('promotions')
      .where('active', '==', true)
      .get();

    const now = new Date();
    const items = snap.docs
      .map(d => ({ id: d.id, ...(d.data() as any) }))
      .filter(p => {
        const start = toJsDate(p.startAt);
        const end   = toJsDate(p.endAt);
        const activeWindow = (!start || now >= start) && (!end || now <= end);
        return p?.code && p?.active !== false && activeWindow;
      })
      .map(p => ({
        id: p.id,
        name: p.name ?? p.title ?? 'Promoción',
        title: p.title ?? p.name ?? 'Promoción',
        code: String(p.code || '').toUpperCase().trim(),
        // si quieres exponer más data, agrégala aquí
      }));

    // dedupe por code
    const seen = new Set<string>();
    const deduped = items.filter(it => {
      const k = it.code;
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    return NextResponse.json({ ok: true, items: deduped }, { status: 200 });
  } catch (e: any) {
    console.error('[GET /api/promotions/public] error:', e);
    return NextResponse.json({ ok: false, error: e?.message || 'Internal error' }, { status: 500 });
  }
}
