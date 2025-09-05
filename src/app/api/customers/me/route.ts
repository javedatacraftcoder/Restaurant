// src/app/api/customers/me/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/firebase/admin";
import { getUserFromRequest } from "@/lib/server/auth";

type Addr = {
  line1?: string;
  city?: string;
  country?: string;
  zip?: string;
  notes?: string;
};

// ➕ Facturación
type Billing = {
  name?: string;
  taxId?: string;
};

type CustomerDoc = {
  uid: string;
  email: string | null;
  displayName?: string | null;
  phone?: string | null;
  addresses?: {
    home?: Addr;
    office?: Addr;
  };
  // ➕ Facturación
  billing?: Billing;
  createdAt?: any;
  updatedAt?: any;
};

const json = (d: unknown, s = 200) => NextResponse.json(d, { status: s });

function sanitizeAddr(a: any): Addr {
  const asStr = (v: any) => (typeof v === "string" ? v : undefined);
  return {
    line1: asStr(a?.line1),
    city: asStr(a?.city),
    country: asStr(a?.country),
    zip: asStr(a?.zip),
    notes: asStr(a?.notes),
  };
}

export async function GET(req: NextRequest) {
  try {
    const user = await getUserFromRequest(req);
    if (!user) return json({ error: "Unauthorized" }, 401);

    const uid = user.uid;
    const ref = db.collection("customers").doc(uid);
    const snap = await ref.get();

    if (!snap.exists) {
      // Crear doc inicial (sin cambios: billing es opcional)
      const initial: CustomerDoc = {
        uid,
        email: user.email ?? null,
        displayName: (user as any)?.name || (user as any)?.displayName || null,
        phone: null,
        addresses: {
          home: { line1: "", city: "", country: "", zip: "", notes: "" },
          office: { line1: "", city: "", country: "", zip: "", notes: "" },
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      await ref.set(initial, { merge: true });
      return json({ ok: true, customer: initial });
    }

    const data = snap.data() as CustomerDoc;
    return json({ ok: true, customer: { id: snap.id, ...data } });
  } catch (e: any) {
    console.error("[GET /api/customers/me] error:", e);
    return json({ error: e?.message || "Server error" }, 500);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const user = await getUserFromRequest(req);
    if (!user) return json({ error: "Unauthorized" }, 401);

    const uid = user.uid;
    const body = await req.json().catch(() => ({} as any));

    // Campos permitidos
    const allowed: Partial<CustomerDoc> = {};

    if (typeof body.displayName === "string") allowed.displayName = body.displayName;
    if (typeof body.phone === "string") allowed.phone = body.phone;

    if (body?.addresses && typeof body.addresses === "object") {
      const nextAddrs: any = {};
      if (body.addresses.home) nextAddrs.home = sanitizeAddr(body.addresses.home);
      if (body.addresses.office) nextAddrs.office = sanitizeAddr(body.addresses.office);
      allowed.addresses = nextAddrs;
    }

    // ➕ Guardar facturación (billing)
    if (body?.billing && typeof body.billing === "object") {
      const b = body.billing;
      const nextBilling: Billing = {};
      if (typeof b.name === "string") nextBilling.name = b.name;
      if (typeof b.taxId === "string") nextBilling.taxId = b.taxId;
      allowed.billing = nextBilling;
    }

    // Evitar cambios de email/uid desde aquí
    delete (allowed as any).uid;
    delete (allowed as any).email;

    // Si no hay nada permitido, retornar 400
    if (!Object.keys(allowed).length) {
      return json({ error: "No valid fields to update" }, 400);
    }

    const ref = db.collection("customers").doc(uid);
    const patch = { ...allowed, updatedAt: new Date() };

    await ref.set(patch, { merge: true });

    const updated = await ref.get();
    return json({ ok: true, customer: { id: updated.id, ...updated.data() } });
  } catch (e: any) {
    console.error("[PUT /api/customers/me] error:", e);
    return json({ error: e?.message || "Server error" }, 500);
  }
}
