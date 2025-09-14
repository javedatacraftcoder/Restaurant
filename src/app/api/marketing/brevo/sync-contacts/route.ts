// src/app/api/marketing/brevo/sync-contacts/route.ts
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { json, requireAdmin, db } from "../_guard";
import { upsertContacts } from "@/lib/marketing/brevo";

function normEmail(v: any) {
  if (!v || typeof v !== "string") return null;
  const e = v.trim().toLowerCase();
  return e.includes("@") ? e : null;
}
function splitName(displayName?: string | null) {
  const dn = (displayName || "").trim();
  if (!dn) return { firstName: "", lastName: "" };
  const parts = dn.split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  const firstName = parts.slice(0, -1).join(" ");
  const lastName = parts.slice(-1).join(" ");
  return { firstName, lastName };
}

export async function POST(req: NextRequest) {
  const me = await requireAdmin(req);
  if (!me) return json({ error: "Forbidden" }, 403);

  try {
    const qp = new URL(req.url).searchParams;
    const includeAll = qp.get("includeAll") === "1";

    const cfgDoc = await db.collection("app_config").doc("marketing").get();
    const cfg = cfgDoc.exists ? cfgDoc.data() : null;
    if (!cfg?.listId) return json({ error: "Missing marketing listId. Run setup first." }, 400);

    const snap = await db.collection("customers").get();

    const contacts: Array<{ email: string; firstName?: string; lastName?: string; attributes?: Record<string, any> }> = [];
    let skippedNoEmail = 0, skippedNoOptin = 0;

    snap.forEach((d) => {
      const c = d.data() as any;
      if (!c) return;

      const email =
        normEmail(c.email) ||
        normEmail(c.userEmail) ||
        normEmail(c.user_email) ||
        normEmail(c.userEmail_lower) ||
        normEmail(c.contact?.email) ||
        normEmail(c.profile?.email);

      if (!email) { skippedNoEmail++; return; }

      const opt =
        c.marketingOptIn === true ||
        c.optIn === true ||
        c.marketing?.optIn === true;

      if (!includeAll && !opt) { skippedNoOptin++; return; }

      const name = (c.name || c.displayName || "").trim();
      const firstName = c.firstName || (name ? splitName(name).firstName : "");
      const lastName = c.lastName || (name ? splitName(name).lastName : "");

      contacts.push({
        email,
        firstName,
        lastName,
        attributes: { UID: d.id, SOURCE: "firestore_customers", OPTIN: opt ? "yes" : "no" },
      });
    });

    if (contacts.length === 0) {
      return json({ ok: true, total: 0, created: 0, updated: 0, failed: [], skippedNoEmail, skippedNoOptin });
    }

    const res = await upsertContacts(contacts, Number(cfg.listId));
    return json({ ok: true, total: contacts.length, ...res, skippedNoEmail, skippedNoOptin });
  } catch (e: any) {
    return json({ error: e?.message || "Sync error" }, 500);
  }
}
