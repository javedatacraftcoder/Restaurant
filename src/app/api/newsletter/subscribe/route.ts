export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';

function isValidEmail(e?: string) {
  return !!e && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json();
    if (!isValidEmail(email)) {
      return NextResponse.json({ ok: false, error: 'invalid_email' }, { status: 400 });
    }

    const apiKey = process.env.BREVO_API_KEY;
    const listIdRaw = process.env.BREVO_NEWSLETTER_LIST_ID; // e.g. "3"
    if (!apiKey) {
      return NextResponse.json({ ok: false, error: 'missing_api_key' }, { status: 500 });
    }

    // Brevo: https://api.brevo.com/v3/contacts
    // If contact exists, updateEnabled:true avoids conflict.
    const payload: any = {
      email,
      updateEnabled: true,
    };
    if (listIdRaw && /^\d+$/.test(listIdRaw)) {
      payload.listIds = [Number(listIdRaw)];
    }

    const r = await fetch('https://api.brevo.com/v3/contacts', {
      method: 'POST',
      headers: {
        'api-key': apiKey,
        'content-type': 'application/json',
        'accept': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (r.ok) {
      return NextResponse.json({ ok: true });
    } else {
      const txt = await r.text().catch(() => '');
      return NextResponse.json({ ok: false, error: 'brevo_error', detail: txt }, { status: 502 });
    }
  } catch (e) {
    return NextResponse.json({ ok: false, error: 'unexpected' }, { status: 500 });
  }
}
