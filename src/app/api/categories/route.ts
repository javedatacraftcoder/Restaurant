// src/app/api/categories/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/firebase/admin";
import { getUserFromRequest } from "@/lib/server/auth";
import { FieldValue } from "firebase-admin/firestore";
import { CategoryCreateSchema } from "@/lib/validators/categories";
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

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const includeAll = searchParams.get("all") === "1"; // ?all=1 para incluir inactivas

    const rawLimit = Number(searchParams.get("limit"));
    const limit =
      Number.isFinite(rawLimit) && rawLimit > 0
        ? Math.min(rawLimit, 500)
        : 200;

    const col = db.collection("categories");

    if (includeAll) {
      // Con todas (activas e inactivas) podemos ordenar en Firestore
      const snap = await col.orderBy("sortOrder", "asc").limit(limit).get();
      const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      return json({ items, count: items.length });
    } else {
      // Solo activas: evitamos índice compuesto (where + orderBy) y ordenamos en memoria
      const snap = await col.where("isActive", "==", true).limit(1000).get();
      const items = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort(
          (a: any, b: any) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)
        )
        .slice(0, limit);

      return json({ items, count: items.length });
    }
  } catch (err: any) {
    console.error("GET /categories error:", err);
    return json({ error: "Internal error" }, 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    // const rl = await rateLimitByIP(req, { key: "categories:POST", limit: 30, windowMs: 60_000 });
    // if (!rl.ok) return json({ error: "Too many requests" }, 429);

    // Auth + rol admin
    const user = await getUserFromRequest(req);
    if (!user || !isAdmin(user)) {
      return json({ error: "Forbidden" }, 403);
    }

    const ct = req.headers.get("content-type") || "";
    if (!ct.includes("application/json")) {
      return json({ error: "Content-Type debe ser application/json" }, 415);
    }

    const raw = await req.json();
    const parsed = CategoryCreateSchema.safeParse(raw);
    if (!parsed.success) {
      return json(
        { error: "Datos inválidos", details: parsed.error.format() },
        422
      );
    }

    const data = parsed.data;
    const name = data.name.trim();
    const slug = (data.slug?.trim() || slugify(name)) as string;

    // Unicidad por slug
    const dup = await db
      .collection("categories")
      .where("slug", "==", slug)
      .limit(1)
      .get();
    if (!dup.empty) {
      return json({ error: "Ya existe una categoría con ese slug" }, 409);
    }

    const now = FieldValue.serverTimestamp();
    const docRef = db.collection("categories").doc();

    const payload = {
      id: docRef.id,
      name,
      slug,
      description: data.description ?? "",
      isActive: data.isActive ?? true,
      sortOrder: data.sortOrder ?? 0,
      createdAt: now,
      updatedAt: now,
    };

    await docRef.set(payload);
    return json({ ok: true, item: payload }, 201);
  } catch (err: any) {
    console.error("POST /categories error:", err);
    return json({ error: "Internal error" }, 500);
  }
}
