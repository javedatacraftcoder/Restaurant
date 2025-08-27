// src/app/api/menu-items/[id]/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/firebase/admin";
import { getUserFromRequest } from "@/lib/server/auth";
import { FieldValue } from "firebase-admin/firestore";
import { MenuItemUpdateSchema } from "@/lib/validators/menuItems";
import { slugify } from "@/lib/utils/slug";
// import { rateLimitByIP } from "@/lib/security/ratelimit";

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
    // const rl = await rateLimitByIP(req, { key: "menu-items:PATCH", limit: 60, windowMs: 60_000 });
    // if (!rl.ok) return json({ error: "Too many requests" }, 429);

    const admin = await requireAdmin(req);
    if (!admin.ok) return admin.res;

    const ct = req.headers.get("content-type") || "";
    if (!ct.includes("application/json")) return json({ error: "Content-Type debe ser application/json" }, 415);

    const ref = db.collection("menuItems").doc(params.id);
    const snap = await ref.get();
    if (!snap.exists) return json({ error: "No encontrado" }, 404);

    const current = snap.data() as any;

    const raw = await req.json();
    const parsed = MenuItemUpdateSchema.safeParse(raw);
    if (!parsed.success) return json({ error: "Datos inválidos", details: parsed.error.format() }, 422);

    const data = parsed.data;

    // Resolver categoryId destino
    let nextCategoryId = data.categoryId ?? current.categoryId;
    if (data.categoryId && data.categoryId !== current.categoryId) {
      const catSnap = await db.collection("categories").doc(nextCategoryId).get();
      if (!catSnap.exists) return json({ error: "categoryId no existe" }, 422);
    }

    // Resolver subcategoryId destino (puede venir null para quitarla)
    let nextSubcategoryId = data.subcategoryId === undefined ? current.subcategoryId : data.subcategoryId;
    if (nextSubcategoryId) {
      const subSnap = await db.collection("subcategories").doc(nextSubcategoryId).get();
      if (!subSnap.exists) return json({ error: "subcategoryId no existe" }, 422);
      const sub = subSnap.data()!;
      if (sub.categoryId !== nextCategoryId) {
        return json({ error: "subcategoryId no pertenece a categoryId" }, 422);
      }
    }

    // Resolver slug
    let nextSlug = data.slug?.trim();
    if (!nextSlug && typeof data.name === "string") nextSlug = slugify(data.name);

    // Validar unicidad por (categoryId, slug) si cambia
    const slugChanged = !!nextSlug && nextSlug !== current.slug;
    const categoryChanged = nextCategoryId !== current.categoryId;

    if ((slugChanged || categoryChanged) && nextSlug) {
      const dup = await db
        .collection("menuItems")
        .where("categoryId", "==", nextCategoryId)
        .where("slug", "==", nextSlug)
        .limit(1)
        .get();
      if (!dup.empty && dup.docs[0].id !== params.id) {
        return json({ error: "Ya existe un ítem con ese slug en la categoría" }, 409);
      }
    }

    const updatePayload: Record<string, any> = {
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (data.name !== undefined) updatePayload.name = data.name.trim();
    if (nextSlug !== undefined) updatePayload.slug = nextSlug;
    if (data.description !== undefined) updatePayload.description = data.description?.trim() ?? "";
    if (data.price !== undefined) updatePayload.price = data.price;
    if (data.currency !== undefined) updatePayload.currency = data.currency;
    if (data.isActive !== undefined) updatePayload.isActive = data.isActive;
    if (data.isAvailable !== undefined) updatePayload.isAvailable = data.isAvailable;
    if (data.sortOrder !== undefined) updatePayload.sortOrder = data.sortOrder;
    if (data.tags !== undefined) updatePayload.tags = data.tags;
    if (data.imageUrl !== undefined) updatePayload.imageUrl = data.imageUrl ?? null;
    if (data.prepMinutes !== undefined) updatePayload.prepMinutes = data.prepMinutes;
    if (nextCategoryId !== undefined) updatePayload.categoryId = nextCategoryId;
    if (data.subcategoryId !== undefined) updatePayload.subcategoryId = nextSubcategoryId ?? null;

    await ref.update(updatePayload);
    const updated = await ref.get();
    return json({ ok: true, item: { id: params.id, ...updated.data() } });
  } catch (err: any) {
    console.error("PATCH /menu-items/[id] error:", err);
    return json({ error: "Internal error" }, 500);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    // const rl = await rateLimitByIP(req, { key: "menu-items:DELETE", limit: 30, windowMs: 60_000 });
    // if (!rl.ok) return json({ error: "Too many requests" }, 429);

    const admin = await requireAdmin(req);
    if (!admin.ok) return admin.res;

    const { searchParams } = new URL(req.url);
    const hard = ["1", "true", "yes"].includes((searchParams.get("hard") || "").toLowerCase());

    const ref = db.collection("menuItems").doc(params.id);
    const snap = await ref.get();
    if (!snap.exists) return json({ error: "No encontrado" }, 404);

    if (hard) {
      // Futuro: bloquear si hay pedidos abiertos que referencien este producto.
      await ref.delete();
      return json({ ok: true, deleted: params.id });
    } else {
      await ref.update({ isActive: false, updatedAt: FieldValue.serverTimestamp() });
      return json({ ok: true, softDeleted: params.id });
    }
  } catch (err: any) {
    console.error("DELETE /menu-items/[id] error:", err);
    return json({ error: "Internal error" }, 500);
  }
}
