// src/app/api/option-groups/[id]/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/firebase/admin";
import { getUserFromRequest } from "@/lib/server/auth";
import { FieldValue, FieldPath } from "firebase-admin/firestore";
import { OptionGroupUpdateSchema } from "@/lib/validators/optionGroups";
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

async function softDeleteOptions(groupId: string) {
  const now = FieldValue.serverTimestamp();
  let last: FirebaseFirestore.QueryDocumentSnapshot | undefined;
  let total = 0;
  while (true) {
    let q = db.collection("optionItems")
      .where("groupId", "==", groupId)
      .where("isActive", "==", true)
      .orderBy(FieldPath.documentId())
      .limit(450);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) break;
    const batch = db.batch();
    snap.docs.forEach(doc => batch.update(doc.ref, { isActive: false, updatedAt: now }));
    await batch.commit();
    total += snap.size;
    last = snap.docs[snap.docs.length - 1];
    if (snap.size < 450) break;
  }
  return total;
}

async function hasOptions(groupId: string) {
  const snap = await db.collection("optionItems").where("groupId", "==", groupId).limit(1).get();
  return !snap.empty;
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const admin = await requireAdmin(req);
    if (!admin.ok) return admin.res;

    const ct = req.headers.get("content-type") || "";
    if (!ct.includes("application/json")) return json({ error: "Content-Type debe ser application/json" }, 415);

    const ref = db.collection("optionGroups").doc(params.id);
    const snap = await ref.get();
    if (!snap.exists) return json({ error: "No encontrado" }, 404);
    const current = snap.data() as any;

    const raw = await req.json();
    const parsed = OptionGroupUpdateSchema.safeParse(raw);
    if (!parsed.success) return json({ error: "Datos inválidos", details: parsed.error.format() }, 422);
    const data = parsed.data;

    // Si cambia menuItemId, validar
    let nextMenuItemId = data.menuItemId ?? current.menuItemId;
    if (data.menuItemId && data.menuItemId !== current.menuItemId) {
      const itSnap = await db.collection("menuItems").doc(nextMenuItemId).get();
      if (!itSnap.exists) return json({ error: "menuItemId no existe" }, 422);
    }

    // Resolver slug
    let nextSlug = data.slug?.trim();
    if (!nextSlug && typeof data.name === "string") nextSlug = slugify(data.name);

    // Unicidad por (menuItemId, slug)
    if ((nextSlug && nextSlug !== current.slug) || (nextMenuItemId !== current.menuItemId)) {
      if (nextSlug) {
        const dup = await db.collection("optionGroups")
          .where("menuItemId", "==", nextMenuItemId)
          .where("slug", "==", nextSlug)
          .limit(1).get();
        if (!dup.empty && dup.docs[0].id !== params.id) {
          return json({ error: "Ya existe un grupo con ese slug para el menú" }, 409);
        }
      }
    }

    // Coherencia min/max
    let minSelect = data.minSelect ?? current.minSelect ?? 0;
    let maxSelect = data.maxSelect ?? current.maxSelect ?? 1;
    if (minSelect > maxSelect) return json({ error: "minSelect no puede ser mayor que maxSelect" }, 422);
    const required = data.required ?? (minSelect >= 1);

    const update: Record<string, any> = { updatedAt: FieldValue.serverTimestamp() };
    if (data.name !== undefined) update.name = data.name.trim();
    if (nextSlug !== undefined) update.slug = nextSlug;
    if (data.description !== undefined) update.description = data.description?.trim() ?? "";
    if (data.isActive !== undefined) update.isActive = data.isActive;
    if (data.sortOrder !== undefined) update.sortOrder = data.sortOrder;
    if (nextMenuItemId !== undefined) update.menuItemId = nextMenuItemId;
    if (data.minSelect !== undefined || data.maxSelect !== undefined) {
      update.minSelect = minSelect;
      update.maxSelect = maxSelect;
      update.required = required;
    }
    if (data.required !== undefined) update.required = data.required;

    await ref.update(update);
    const updated = await ref.get();
    return json({ ok: true, item: { id: params.id, ...updated.data() } });
  } catch (e: any) {
    console.error("PATCH /option-groups/[id] error:", e);
    return json({ error: "Internal error" }, 500);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const admin = await requireAdmin(req);
    if (!admin.ok) return admin.res;

    const { searchParams } = new URL(req.url);
    const hard = ["1","true","yes"].includes((searchParams.get("hard")||"").toLowerCase());
    const cascade = ["1","true","yes"].includes((searchParams.get("cascade")||"").toLowerCase());

    const ref = db.collection("optionGroups").doc(params.id);
    const snap = await ref.get();
    if (!snap.exists) return json({ error: "No encontrado" }, 404);

    if (hard) {
      if (await hasOptions(params.id)) {
        return json({ error: "No se puede eliminar definitivamente: existen opciones en el grupo.", hint: "Usa soft delete con ?cascade=1 o elimina las opciones primero." }, 409);
      }
      await ref.delete();
      return json({ ok: true, deleted: params.id });
    } else {
      await ref.update({ isActive: false, updatedAt: FieldValue.serverTimestamp() });
      let affected = 0;
      if (cascade) affected = await softDeleteOptions(params.id);
      return json({ ok: true, softDeleted: params.id, optionItemsSoftDeleted: affected });
    }
  } catch (e: any) {
    console.error("DELETE /option-groups/[id] error:", e);
    return json({ error: "Internal error" }, 500);
  }
}
