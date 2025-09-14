// src/app/api/marketing/brevo/campaigns/[id]/send-now/route.ts
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { json, requireAdmin, db } from "../../../_guard";
import { sendCampaignNow } from "@/lib/marketing/brevo";

export async function POST(req: NextRequest, ctx: { params: { id: string } }) {
  const me = await requireAdmin(req);
  if (!me) return json({ error: "Forbidden" }, 403);

  try {
    const id = Number(ctx.params.id);
    await sendCampaignNow(id);

    await db.collection("app_logs").add({
      type: "campaign.sendNow",
      provider: "brevo",
      campaignId: id,
      at: new Date(),
      by: me.uid,
    });

    return json({ ok: true });
  } catch (e: any) {
    return json({ error: e?.message || "Send error" }, 500);
  }
}
