// src/app/api/pay/paypal/capture/route.ts
import { NextRequest, NextResponse } from 'next/server';
import * as admin from 'firebase-admin';

function getAdmin() {
  if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.applicationDefault() });
  return admin;
}

async function getPaypalAccessToken() {
  const cid = process.env.PAYPAL_CLIENT_ID!;
  const sec = process.env.PAYPAL_CLIENT_SECRET!;
  const isLive = process.env.PAYPAL_ENV === 'live';
  const base = isLive ? 'https://api.paypal.com' : 'https://api.sandbox.paypal.com';
  const authRes = await fetch(`${base}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': 'Basic ' + Buffer.from(`${cid}:${sec}`).toString('base64'),
    },
    body: 'grant_type=client_credentials',
    cache: 'no-store',
  });
  if (!authRes.ok) throw new Error('PayPal auth failed');
  return (await authRes.json() as any).access_token as string;
}

export async function POST(req: NextRequest) {
  try {
    const { paypalOrderId } = await req.json().catch(() => ({}));
    if (!paypalOrderId) return NextResponse.json({ error: 'Missing paypalOrderId' }, { status: 400 });

    const token = await getPaypalAccessToken();
    const isLive = process.env.PAYPAL_ENV === 'live';
    const base = isLive ? 'https://api.paypal.com' : 'https://api.sandbox.paypal.com';

    // Capturar
    const capRes = await fetch(`${base}/v2/checkout/orders/${paypalOrderId}/capture`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      cache: 'no-store',
      body: JSON.stringify({}),
    });
    if (!capRes.ok) {
      const t = await capRes.text();
      throw new Error(`PayPal capture failed: ${t}`);
    }
    const data = await capRes.json();

    // Buscar draft por paypalOrderId
    const db = getAdmin().firestore();
    const drafts = await db.collection('orderDrafts').where('paypalOrderId', '==', paypalOrderId).limit(1).get();
    const draftSnap = drafts.docs[0];
    if (!draftSnap?.exists) return NextResponse.json({ ok: true, note: 'draft not found' });

    const draft = draftSnap.data() || {};
    if (draft.status === 'completed' && draft.orderId) {
      return NextResponse.json({ ok: true, orderId: draft.orderId });
    }

    const payload = draft.payload || {};
    const orderRef = await db.collection('orders').add({
      ...payload,
      payment: {
        provider: 'paypal',
        status: 'succeeded',
        amount: payload?.orderTotal || 0,
        currency: (payload?.totals?.currency || 'GTQ'),
        paypalOrderId,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    await draftSnap.ref.update({
      status: 'completed',
      completedAt: admin.firestore.FieldValue.serverTimestamp(),
      orderId: orderRef.id,
    });

    return NextResponse.json({ ok: true, orderId: orderRef.id }, { status: 200 });
  } catch (e: any) {
    console.error('[paypal/capture] error:', e);
    return NextResponse.json({ error: e?.message || 'Error' }, { status: 500 });
  }
}
