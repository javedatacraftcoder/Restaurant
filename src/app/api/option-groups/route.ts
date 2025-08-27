// src/app/api/option-groups/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/firebase/admin";

const json = (d: unknown, s = 200) => NextResponse.json(d, { status: s });

/**
 * GET /api/option-groups?menuItemId=ID
 * Query:
 *  - menuItemId: string (requerido)
 *  - all=1      → incluye inactivos (por defecto solo activos)
 *  - limit?: number (<=200)
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const menuItemId = searchParams.get("menuItemId");
  const includeAll = searchParams.get("all") === "1";
  const limit = Math.min(Number(searchParams.get("limit") ?? 100), 200);

  if (!menuItemId) return json({ error: "menuItemId requerido" }, 400);

  try {
    let qRef = db
      .collection("optionGroups")
      .where("menuItemId", "==", menuItemId) as FirebaseFirestore.Query;

    if (!includeAll) qRef = qRef.where("isActive", "==", true);

    qRef = qRef.orderBy("sortOrder", "asc").limit(limit);

    const snap = await qRef.get();
    const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    return json({ items, count: items.length });
  } catch (e: any) {
    const isIndexIssue =
      e?.code === 9 ||
      e?.code === "failed-precondition" ||
      (e?.message ?? "").includes("FAILED_PRECONDITION");

    if (!isIndexIssue) {
      console.error("[GET /option-groups]", e);
      return json({ error: e?.message ?? "Internal error" }, 500);
    }

    try {
      let qRef = db
        .collection("optionGroups")
        .where("menuItemId", "==", menuItemId) as FirebaseFirestore.Query;

      if (!includeAll) qRef = qRef.where("isActive", "==", true);

      const snap = await qRef.limit(limit).get();
      const items = snap.docs
        .map((d) => ({ id: d.id, ...d.data() } as any))
        .sort((a, b) => (Number(a.sortOrder ?? 0) - Number(b.sortOrder ?? 0)));

      return new NextResponse(JSON.stringify({ items, count: items.length }), {
        status: 200,
        headers: { "x-firestore-index-fallback": "1", "content-type": "application/json" },
      });
    } catch (e2: any) {
      console.error("[GET /option-groups fallback]", e2);
      return json({ error: e2?.message ?? "Internal error" }, 500);
    }
  }
}
