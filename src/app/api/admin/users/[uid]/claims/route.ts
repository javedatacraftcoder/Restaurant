// src/app/api/admin/users/[uid]/claims/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getUserFromRequest } from "@/lib/server/auth";
import { db } from "@/lib/firebase/admin"; // asegura que inicializa admin SDK
import admin from "firebase-admin";

const json = (d: unknown, s = 200) => NextResponse.json(d, { status: s });

const BodySchema = z.object({
  admin: z.boolean().optional(),
  kitchen: z.boolean().optional(),
  waiter: z.boolean().optional(),
  delivery: z.boolean().optional(),
});

function requireSecret(req: NextRequest) {
  const hdr = req.headers.get("x-admin-secret")?.trim();
  const expected = process.env.ADMIN_TASKS_SECRET?.trim();
  return Boolean(expected && hdr && hdr === expected);
}

// Helper robusto para admin (evita TS en user.isAdmin/claims)
function isAdminUser(user: any): boolean {
  return (
    user?.role === "admin" ||
    user?.isAdmin === true ||
    user?.claims?.admin === true
  );
}

export async function POST(
  req: NextRequest,
  { params }: { params: { uid: string } }
) {
  try {
    const me = await getUserFromRequest(req);
    if (!me || !isAdminUser(me)) return json({ error: "Forbidden" }, 403);
    if (!requireSecret(req)) return json({ error: "Missing/invalid secret" }, 401);

    const uid = params.uid;
    const raw = await req.json();
    const parsed = BodySchema.safeParse(raw);
    if (!parsed.success) {
      return json({ error: "Datos inválidos", details: parsed.error.format() }, 422);
    }

    // Solo escribimos claves definidas (no undefined) para no “barrer” valores previos
    const toSet: Record<string, boolean> = {};
    for (const k of ["admin", "kitchen", "waiter", "delivery"] as const) {
      const v = (parsed.data as any)[k];
      if (typeof v === "boolean") toSet[k] = v;
    }

    // Mezclar con claims actuales (sin borrar otros)
    const userRec = await admin.auth().getUser(uid);
    const current = (userRec.customClaims as Record<string, any>) || {};
    const next = { ...current, ...toSet };

    await admin.auth().setCustomUserClaims(uid, next);

    // Auditoría simple
    const actorId = (me as any)?.uid ?? (me as any)?.id ?? null;
    await db.collection("_admin_audit").add({
      at: new Date().toISOString(),
      by: actorId,
      target: uid,
      claims: next,
      type: "setCustomClaims",
    });

    return json({ ok: true, uid, claims: next }, 200);
  } catch (e: any) {
    console.error("POST /admin/users/[uid]/claims error:", e);
    return json({ error: e?.message ?? "Internal error" }, 500);
  }
}
