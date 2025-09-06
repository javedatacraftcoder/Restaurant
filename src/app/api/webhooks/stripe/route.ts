// src/app/api/webhooks/stripe/route.ts
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import * as admin from 'firebase-admin';
import Stripe from 'stripe';

function getAdmin() {
  if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.applicationDefault() });
  }
  return admin;
}

export async function POST(req: NextRequest) {
  // ✅ asegura que existan las env vars
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const stripeSecret = process.env.STRIPE_SECRET_KEY;
  if (!webhookSecret || !stripeSecret) {
    return NextResponse.json(
      { error: 'Missing STRIPE_WEBHOOK_SECRET or STRIPE_SECRET_KEY' },
      { status: 500 }
    );
  }

  // ✅ Stripe SDK en runtime Node con apiVersion tipada
  const stripe = new Stripe(stripeSecret, {
    apiVersion: '2024-06-20' as Stripe.LatestApiVersion,
  });

  // ⚠️ obtener raw body para verificar firma
  let event: Stripe.Event;
  try {
    const body = Buffer.from(await req.arrayBuffer());
    const signature = req.headers.get('stripe-signature') ?? '';
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (err: any) {
    console.error('[stripe webhook] signature error:', err?.message);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  try {
    const db = getAdmin().firestore();

    if (event.type === 'payment_intent.succeeded') {
      const pi = event.data.object as Stripe.PaymentIntent;
      const draftId = (pi.metadata as any)?.draftId;
      if (!draftId) return NextResponse.json({ ok: true });

      const draftRef = db.collection('orderDrafts').doc(String(draftId));
      const snap = await draftRef.get();
      if (!snap.exists) return NextResponse.json({ ok: true });

      const d = snap.data() || {};
      if (d.status === 'completed') return NextResponse.json({ ok: true }); // idempotente

      const payload = d.payload || {};
      const orderRef = await db.collection('orders').add({
        ...payload,
        payment: {
          provider: 'stripe',
          status: 'succeeded',
          amount: payload?.orderTotal || 0,
          currency: (payload?.totals?.currency || 'GTQ'),
          intentId: pi.id,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      await draftRef.update({
        status: 'completed',
        orderId: orderRef.id,
        completedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }

    if (event.type === 'payment_intent.payment_failed') {
      const pi = event.data.object as Stripe.PaymentIntent;
      const draftId = (pi.metadata as any)?.draftId;
      if (draftId) {
        await db.collection('orderDrafts').doc(String(draftId)).update({
          status: 'failed',
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error('[stripe webhook] handler error:', e);
    return NextResponse.json({ error: e?.message || 'Error' }, { status: 500 });
  }
}

// (Opcional) Si quieres soportar verificación rápida del endpoint
export async function GET() {
  return NextResponse.json({ ok: true });
}
