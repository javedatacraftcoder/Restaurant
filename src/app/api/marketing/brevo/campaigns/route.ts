// src/app/api/marketing/brevo/campaigns/route.ts
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { json, requireAdmin, db } from "../_guard";
import { createCampaign, listCampaigns } from "@/lib/marketing/brevo";

export async function GET(req: NextRequest) {
  const me = await requireAdmin(req);
  if (!me) return json({ error: "Forbidden" }, 403);

  try {
    const query = new URL(req.url).searchParams;
    const limit = Number(query.get("limit") || 20);
    const offset = Number(query.get("offset") || 0);
    const data = await listCampaigns(limit, offset);
    return json({ ok: true, ...data });
  } catch (e: any) {
    return json({ error: e?.message || "List error" }, 500);
  }
}

export async function POST(req: NextRequest) {
  const me = await requireAdmin(req);
  if (!me) return json({ error: "Forbidden" }, 403);

  try {
    const body = await req.json();
    const subject = String(body.subject || "").trim();
    const html = String(body.html || "").trim();
    if (!subject || !html) return json({ error: "Missing subject/html" }, 400);

    const cfgDoc = await db.collection("app_config").doc("marketing").get();
    const cfg = cfgDoc.exists ? cfgDoc.data() : null;
    if (!cfg?.listId) return json({ error: "Missing marketing listId. Run setup first." }, 400);

    const senderName = process.env.BREVO_SENDER_NAME || "OrderCraft";
    const senderEmail = process.env.BREVO_SENDER_EMAIL;
    if (!senderEmail) return json({ error: "Missing BREVO_SENDER_EMAIL env" }, 500);

    const created = await createCampaign({
      subject,
      htmlContent: html,
      listId: Number(cfg.listId),
      senderName,
      senderEmail,
    });

    // Save a tiny log (optional)
    await db.collection("app_logs").add({
      type: "campaign.created",
      provider: "brevo",
      campaignId: created.id,
      subject,
      at: new Date(),
      by: me.uid,
    });

    return json({ ok: true, campaign: created });
  } catch (e: any) {
    return json({ error: e?.message || "Create error" }, 500);
  }
}
