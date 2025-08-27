// src/app/api/categories/[id]/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/firebase/admin";
import { getUserFromRequest } from "@/lib/server/auth";
import { FieldValue, FieldPath } from "firebase-admin/firestore";
import { CategoryUpdateSchema } from "@/lib/validators/categories";
import { slugify } from "@/lib/utils/slug";
// import { rateLimitByIP } from "@/lib/security/ratelimit";

const json = (d: unknown, s = 200) => NextResponse.json(d, { status: s });

function isAdmin(user: any) {
  return (
    user?.role === "admin" ||
    user?.isAdmin === true ||
    user?.claims?.admin === true
  );
}

async function requireAdmin(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user || !isAdmin(user)) {
    return { ok: false as const, res: json({ error: "Forbidden" }, 403) };
  }
  return { ok: true as const, user };
}

/**
 * Verifica existencia de subcategorías para una categoría dada.
 * Retorna 0 si no hay, 1 si hay (optimizamos con limit(1)).
 */
async function hasSubcategories(categoryId: string) {
  const snap = await db
    .collection("subcategories")
    .where("categoryId", "==", categoryId)
    .limit(1)
    .get();
  return !snap.empty;
}

/**
 * Desactiva en batch todas las subcategorías activas de la categoría.
 * Trabaja en páginas para evitar límites de batch.
 */
async function softDeleteSubcategories(categoryId: string) {
  const now = FieldValue.serverTimestamp();
  let total = 0;
  let lastDoc: any = undefined;

  while (true) {
    let q = db
      .collection("subcategories")
      .where("categoryId", "==", categoryId)
      .where("isActive", "==", true)
      .orderBy(FieldPath.documentId())
      .limit(450);

    if (lastDoc) q = q.startAfter(lastDoc);

    const snap = await q.get();
    if (snap.empty) break;

    const batch = db.batch();
    snap.docs.forEach((doc) => {
      batch.update(doc.ref, { isActive: false, updatedAt: now });
    });
    await batch.commit();

    total += snap.size;
    lastDoc = snap.docs[snap.docs.length - 1];
    if (snap.size < 450) break;
  }
  return total;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    // const rl = await rateLimitByIP(req, { key: "categories:PATCH", limit: 60, windowMs: 60_000 });
    // if (!rl.ok) return json({ error: "Too many requests" }, 429);

    const adminCheck = await requireAdmin(req);
    if (!adminCheck.ok) return adminCheck.res;

    const ct = req.headers.get("content-type") || "";
    if (!ct.includes("application/json")) {
      return json({ error: "Content-Type debe ser application/json" }, 415);
    }

    const { id } = params;
    const ref = db.collection("categories").doc(id);
    const snap = await ref.get();
    if (!snap.exists) return json({ error: "No encontrado" }, 404);

    const raw = await req.json();
    const parsed = CategoryUpdateSchema.safeParse(raw);
    if (!parsed.success) {
      return json(
        { error: "Datos inválidos", details: parsed.error.format() },
        422
      );
    }

    const data = parsed.data;
    const current = snap.data() || {};

    // Si cambia name y no se envió slug, se regenera
    let nextSlug = data.slug?.trim();
    if (!nextSlug && typeof data.name === "string") {
      nextSlug = slugify(data.name);
    }

    // Validar unicidad de slug si cambia
    if (nextSlug && nextSlug !== current.slug) {
      const dup = await db
        .collection("categories")
        .where("slug", "==", nextSlug)
        .limit(1)
        .get();
      if (!dup.empty) {
        return json({ error: "Ya existe una categoría con ese slug" }, 409);
      }
    }

    const updatePayload: Record<string, any> = {
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (data.name !== undefined) updatePayload.name = data.name.trim();
    if (nextSlug !== undefined) updatePayload.slug = nextSlug;
    if (data.description !== undefined)
      updatePayload.description = data.description?.trim() ?? "";
    if (data.isActive !== undefined) updatePayload.isActive = data.isActive;
    if (data.sortOrder !== undefined) updatePayload.sortOrder = data.sortOrder;

    await ref.update(updatePayload);
    const updated = await ref.get();
    return json({ ok: true, item: { id, ...updated.data() } });
  } catch (err: any) {
    console.error("PATCH /categories/[id] error:", err);
    return json({ error: "Internal error" }, 500);
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    // const rl = await rateLimitByIP(req, { key: "categories:DELETE", limit: 30, windowMs: 60_000 });
    // if (!rl.ok) return json({ error: "Too many requests" }, 429);

    const adminCheck = await requireAdmin(req);
    if (!adminCheck.ok) return adminCheck.res;

    const { searchParams } = new URL(req.url);
    const hard = ["1", "true", "yes"].includes(
      (searchParams.get("hard") || "").toLowerCase()
    );
    const cascade = ["1", "true", "yes"].includes(
      (searchParams.get("cascade") || "").toLowerCase()
    );

    const { id } = params;
    const ref = db.collection("categories").doc(id);
    const snap = await ref.get();
    if (!snap.exists) return json({ error: "No encontrado" }, 404);

    const now = FieldValue.serverTimestamp();

    if (hard) {
      // Bloquear hard delete si hay subcategorías
      if (await hasSubcategories(id)) {
        return json(
          {
            error:
              "No se puede eliminar definitivamente: existen subcategorías.",
            hint:
              "Elimina o desactiva primero las subcategorías, o realiza soft delete con ?cascade=1.",
          },
          409
        );
      }
      await ref.delete();
      return json({ ok: true, deleted: id });
    } else {
      // Soft delete de la categoría
      await ref.update({ isActive: false, updatedAt: now });

      let affected = 0;
      if (cascade) {
        affected = await softDeleteSubcategories(id);
      }
      return json({
        ok: true,
        softDeleted: id,
        subcategoriesSoftDeleted: affected,
      });
    }
  } catch (err: any) {
    console.error("DELETE /categories/[id] error:", err);
    return json({ error: "Internal error" }, 500);
  }
}
