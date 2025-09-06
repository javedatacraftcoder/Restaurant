// src/app/api/pay/paypal/create-order/route.ts
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
  const res = await fetch(`${base}/v1/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
    cache: 'no-store',
    // Basic auth
    // @ts-ignore
    headers2: { Authorization: 'Basic ' + Buffer.from(`${cid}:${sec}`).toString('base64') }
  } as any);
  // Workaround because Next merges headers; do it clean:
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
    const body = await req.json().catch(() => ({}));
    const orderDraft = body?.orderDraft;
    if (!orderDraft) return NextResponse.json({ error: 'Missing orderDraft' }, { status: 400 });

    const currency = (orderDraft?.totals?.currency || process.env.PAY_CURRENCY || 'GTQ').toUpperCase();
    const amount = Number(orderDraft?.orderTotal || 0).toFixed(2);

    const token = await getPaypalAccessToken();
    const isLive = process.env.PAYPAL_ENV === 'live';
    const base = isLive ? 'https://api.paypal.com' : 'https://api.sandbox.paypal.com';

    // Guardar draft
    const db = getAdmin().firestore();
    const draftRef = await db.collection('orderDrafts').add({
      status: 'pending',
      provider: 'paypal',
      currency,
      amount: Number(amount),
      payload: orderDraft,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Crear Paypal Order
    const resp = await fetch(`${base}/v2/checkout/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      cache: 'no-store',
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [{ amount: { currency_code: currency, value: amount } }],
        application_context: { shipping_preference: 'NO_SHIPPING' },
      }),
    });
    if (!resp.ok) {
      const t = await resp.text();
      throw new Error(`PayPal create failed: ${t}`);
    }
    const data = await resp.json();
    const paypalOrderId = data.id as string;

    await draftRef.update({ paypalOrderId });

    return NextResponse.json({ paypalOrderId }, { status: 200 });
  } catch (e: any) {
    console.error('[paypal/create-order] error:', e);
    return NextResponse.json({ error: e?.message || 'Error' }, { status: 500 });
  }
}
