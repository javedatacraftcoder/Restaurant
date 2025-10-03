// src/app/api/marketing/brevo/contacts/route.ts
import { NextRequest, NextResponse } from 'next/server';

type BrevoContact = {
  id: number;
  email: string;
  attributes?: Record<string, any>;
  emailBlacklisted?: boolean;
  smsBlacklisted?: boolean;
  createdAt?: string;
  listIds?: number[];
};

function toStringSafe(v: any) {
  return typeof v === 'string' ? v : v == null ? '' : String(v);
}

/**
 * GET /api/marketing/brevo/contacts
 * Query params:
 *  - q?: string (búsqueda por email/nombre, filtra del lado servidor)
 *  - status?: 'all' | 'subscribed' | 'unsubscribed' | 'blacklisted'
 *  - listId?: string (opcional: usa endpoint de contactos por lista)
 *  - limit?: number (default 50)
 *  - offset?: number (default 0) => se pasa directo a Brevo
 */
export async function GET(req: NextRequest) {
  try {
    const apiKey = process.env.BREVO_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'Missing BREVO_API_KEY' }, { status: 500 });
    }

    const { searchParams } = new URL(req.url);
    const q = (searchParams.get('q') || '').trim().toLowerCase();
    const status = (searchParams.get('status') || 'all').toLowerCase();
    const listId = searchParams.get('listId') || '';
    const limit = Math.min(100, Math.max(1, Number(searchParams.get('limit') || 50)));
    const offset = Math.max(0, Number(searchParams.get('offset') || 0));

    const base = listId
      ? `https://api.brevo.com/v3/contacts/lists/${encodeURIComponent(listId)}/contacts`
      : `https://api.brevo.com/v3/contacts`;

    const url = new URL(base);
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('offset', String(offset));
    url.searchParams.set('sort', 'desc');

    const res = await fetch(url.toString(), {
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'api-key': apiKey,
      },
      method: 'GET',
    });

    if (!res.ok) {
      const jr = await res.json().catch(() => ({}));
      return NextResponse.json(
        { error: jr?.message || `Brevo error (${res.status})` },
        { status: 502 }
      );
    }

    const data = await res.json();
    const raw: BrevoContact[] = data?.contacts || data?.results || [];

    // Normaliza y filtra
    const normalized = raw.map((c) => {
      const firstName =
        c?.attributes?.FIRSTNAME ??
        c?.attributes?.FirstName ??
        c?.attributes?.firstName ??
        '';
      const lastName =
        c?.attributes?.LASTNAME ??
        c?.attributes?.LastName ??
        c?.attributes?.lastName ??
        '';
      const name = [firstName, lastName].filter(Boolean).join(' ').trim();

      const computedStatus = c.emailBlacklisted ? 'unsubscribed' : 'subscribed';

      return {
        id: c.id,
        email: c.email,
        name,
        firstName,
        lastName,
        createdAt: c.createdAt || null,
        listIds: Array.isArray(c.listIds) ? c.listIds : [],
        emailBlacklisted: !!c.emailBlacklisted,
        smsBlacklisted: !!c.smsBlacklisted,
        status: computedStatus,
      };
    });

    const filtered = normalized.filter((c) => {
      const matchesQ =
        !q ||
        toStringSafe(c.email).toLowerCase().includes(q) ||
        toStringSafe(c.name).toLowerCase().includes(q);

      const matchesStatus =
        status === 'all' ||
        (status === 'subscribed' && c.status === 'subscribed') ||
        (status === 'unsubscribed' && c.status === 'unsubscribed') ||
        (status === 'blacklisted' && c.emailBlacklisted === true);

      return matchesQ && matchesStatus;
    });

    return NextResponse.json({
      items: filtered,
      page: { limit, offset, returned: filtered.length },
      // el total real de Brevo no se expone aquí (depende del filtro del cliente),
      // pero exponemos hints útiles:
      brevo: {
        // algunos SDKs devuelven "count"; otros no. En Postman se usan limit/offset/sort.
        // Pasamos el hint de que puedes pedir el siguiente offset.
        nextOffset: offset + limit,
        // si te interesa el payload crudo, habilita un flag y devuélvelo (no por defecto).
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Server error' }, { status: 500 });
  }
}
