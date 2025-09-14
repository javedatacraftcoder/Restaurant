// src/app/api/marketing/brevo/campaigns/[id]/send-test/route.ts
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { json, requireAdmin, db } from "../../../_guard";
import { sendCampaignTest, upsertContacts } from "@/lib/marketing/brevo";

export async function POST(req: NextRequest, ctx: { params: { id: string } }) {
  const me = await requireAdmin(req);
  if (!me) return json({ error: "Forbidden" }, 403);

  try {
    const id = Number(ctx.params.id);
    const body = await req.json().catch(() => ({}));
    let emails: string[] = Array.isArray(body?.emailTo)
      ? body.emailTo
      : (body?.email ? [body.email] : []);
    emails = emails
      .filter((e: any) => typeof e === "string")
      .map((e) => e.trim().toLowerCase())
      .filter((e) => e.includes("@"));
    if (!emails.length) return json({ error: "Missing emailTo" }, 400);

    // Cargar listId (creado por /setup)
    const cfgDoc = await db.collection("app_config").doc("marketing").get();
    const cfg = cfgDoc.exists ? cfgDoc.data() : null;
    if (!cfg?.listId) return json({ error: "Missing marketing listId. Run setup first." }, 400);

    // 1) Upsert de contactos de prueba a la lista
    const up = await upsertContacts(
      emails.map((email) => ({ email })),
      Number(cfg.listId)
    );
    if (up.failed?.length) {
      const detail = up.failed.map((f) => `${f.email}: ${f.error}`).join(", ");
      return json({ error: `No se pudieron preparar estos contactos: ${detail}` }, 400);
    }

    // 2) Enviar test
    await sendCampaignTest(id, emails);
    return json({ ok: true });
  } catch (e: any) {
    return json({ error: e?.message || "SendTest error" }, 400);
  }
}
