// src/app/api/marketing/brevo/setup/route.ts
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { json, requireAdmin, db } from "../_guard";
import { ensureFolderAndList } from "@/lib/marketing/brevo";

export async function POST(req: NextRequest) {
  const me = await requireAdmin(req);
  if (!me) return json({ error: "Forbidden" }, 403);

  try {
    const conf = await ensureFolderAndList();
    await db.collection("app_config").doc("marketing").set({
      provider: "brevo",
      ...conf,
      updatedAt: new Date(),
    }, { merge: true });

    return json({ ok: true, config: conf });
  } catch (e: any) {
    return json({ error: e?.message || "Setup error" }, 500);
  }
}
