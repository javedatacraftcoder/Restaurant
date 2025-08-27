// src/app/api/option-items/[id]/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/firebase/admin";
import { getUserFromRequest } from "@/lib/server/auth";
import { FieldValue } from "firebase-admin/firestore";
import { OptionItemUpdateSchema } from "@/lib/validators/optionItems";
import { slugify } from "@/lib/utils/slug";

const json = (d: unknown, s = 200) => NextResponse.json(d, { status: s });

function isAdmin(user: any) {
  return user?.role === "admin" || user?.isAdmin === true || user?.claims?.admin === true;
}

async function requireAdmin(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user || !isAdmin(user)) return { ok: false as const, res: json({ error: "Forbidden" }, 403) };
  return { ok: true as const, user };
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const admin = await requireAdmin(req);
    if (!admin.ok) return admin.res;

    const ct = req.headers.get("content-type") || "";
    if (!ct.includes("application/json")) return json({ error: "Content-Type debe ser application/json" }, 415);

    const ref = db.collection("optionItems").doc(params.id);
    const snap = await ref.get();
    if (!snap.exists) return json({ error: "No encontrado" }, 404);
    const current = snap.data() as any;

    const raw = await req.json();
    const parsed = OptionItemUpdateSchema.safeParse(raw);
    if (!parsed.success) return json({ error: "Datos inválidos", details: parsed.error.format() }, 422);
    const data = parsed.data;

    // Si cambia el groupId, validar y traer menuItemId
    let nextGroupId = data.groupId ?? current.groupId;
    let nextMenuItemId = current.menuItemId;
    if (data.groupId && data.groupId !== current.groupId) {
      const gSnap = await db.collection("optionGroups").doc(nextGroupId).get();
      if (!gSnap.exists) return json({ error: "groupId no existe" }, 422);
      nextMenuItemId = (gSnap.data() as any).menuItemId;
    }

    // Resolver slug
    let nextSlug = data.slug?.trim();
    if (!nextSlug && typeof data.name === "string") nextSlug = slugify(data.name);

    // Unicidad por (groupId, slug)
    if ((nextSlug && nextSlug !== current.slug) || (nextGroupId !== current.groupId)) {
      if (nextSlug) {
        const dup = await db.collection("optionItems")
          .where("groupId", "==", nextGroupId)
          .where("slug", "==", nextSlug)
          .limit(1).get();
        if (!dup.empty && dup.docs[0].id !== params.id) {
          return json({ error: "Ya existe una opción con ese slug en el grupo" }, 409);
        }
      }
    }

    const update: Record<string, any> = { updatedAt: FieldValue.serverTimestamp() };
    if (data.name !== undefined) update.name = data.name.trim();
    if (nextSlug !== undefined) update.slug = nextSlug;
    if (data.description !== undefined) update.description = data.description?.trim() ?? "";
    if (data.priceDelta !== undefined) update.priceDelta = data.priceDelta;
    if (data.isDefault !== undefined) update.isDefault = data.isDefault;
    if (data.isActive !== undefined) update.isActive = data.isActive;
    if (data.sortOrder !== undefined) update.sortOrder = data.sortOrder;
    if (data.groupId !== undefined) {
      update.groupId = nextGroupId;
      update.menuItemId = nextMenuItemId;
    }

    await ref.update(update);
    const updated = await ref.get();
    return json({ ok: true, item: { id: params.id, ...updated.data() } });
  } catch (e: any) {
    console.error("PATCH /option-items/[id] error:", e);
    return json({ error: "Internal error" }, 500);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const admin = await requireAdmin(req);
    if (!admin.ok) return admin.res;

    const { searchParams } = new URL(req.url);
    const hard = ["1","true","yes"].includes((searchParams.get("hard")||"").toLowerCase());

    const ref = db.collection("optionItems").doc(params.id);
    const snap = await ref.get();
    if (!snap.exists) return json({ error: "No encontrado" }, 404);

    if (hard) {
      // Futuro: bloquear si hay pedidos abiertos que refieran esta opción
      await ref.delete();
      return json({ ok: true, deleted: params.id });
    } else {
      await ref.update({ isActive: false, updatedAt: FieldValue.serverTimestamp() });
      return json({ ok: true, softDeleted: params.id });
    }
  } catch (e: any) {
    console.error("DELETE /option-items/[id] error:", e);
    return json({ error: "Internal error" }, 500);
  }
}
