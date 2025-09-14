// src/app/api/marketing/brevo/sync-all/route.ts
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { json, requireAdmin, db } from "../_guard";
import { upsertContacts } from "@/lib/marketing/brevo";
import { adminAuth } from "@/lib/firebase/admin";

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

async function listAllAuthUsers() {
  const acc: Array<{ email: string; firstName?: string; lastName?: string; attributes?: Record<string, any> }> = [];
  let nextPageToken: string | undefined = undefined;
  do {
    const page = await adminAuth.listUsers(1000, nextPageToken);
    for (const u of page.users) {
      const email = normEmail(u.email);
      if (!email) continue;
      if (u.disabled) continue;
      // Por entregabilidad: prioriza verificados
      if (!u.emailVerified) continue;
      const { firstName, lastName } = splitName(u.displayName);
      acc.push({
        email,
        firstName,
        lastName,
        attributes: { UID: u.uid, SOURCE: "firebase_auth", EMAIL_VERIFIED: u.emailVerified ? "yes" : "no" },
      });
    }
    nextPageToken = page.pageToken;
  } while (nextPageToken);
  return acc;
}

async function listAllCustomers(includeAll: boolean) {
  const snap = await db.collection("customers").get();
  const acc: Array<{ email: string; firstName?: string; lastName?: string; attributes?: Record<string, any> }> = [];

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

    if (!email) return;

    const opt =
      c.marketingOptIn === true ||
      c.optIn === true ||
      c.marketing?.optIn === true;

    if (!includeAll && !opt) return;

    const name = (c.name || c.displayName || "").trim();
    const firstName = c.firstName || (name ? splitName(name).firstName : "");
    const lastName = c.lastName || (name ? splitName(name).lastName : "");

    acc.push({
      email,
      firstName,
      lastName,
      attributes: {
        UID: d.id,
        SOURCE: "firestore_customers",
        OPTIN: opt ? "yes" : "no",
      },
    });
  });

  return acc;
}

export async function POST(req: NextRequest) {
  const me = await requireAdmin(req);
  if (!me) return json({ error: "Forbidden" }, 403);

  try {
    const qp = new URL(req.url).searchParams;
    const includeAllFs = qp.get("includeFirestoreAll") === "1" || qp.get("includeAll") === "1";

    const cfgDoc = await db.collection("app_config").doc("marketing").get();
    const cfg = cfgDoc.exists ? cfgDoc.data() : null;
    if (!cfg?.listId) return json({ error: "Missing marketing listId. Run setup first." }, 400);

    const [authContacts, customerContacts] = await Promise.all([
      listAllAuthUsers(),
      listAllCustomers(includeAllFs),
    ]);

    // Deduplicación por email (prefiere Auth verificado)
    const map = new Map<string, { email: string; firstName?: string; lastName?: string; attributes?: Record<string, any> }>();
    for (const c of customerContacts) map.set(c.email, c);
    for (const a of authContacts) {
      const prev = map.get(a.email);
      if (!prev) { map.set(a.email, a); continue; }
      // Merge: si viene Auth (verificado), que prevalezca nombre de Auth si no existe
      map.set(a.email, {
        email: a.email,
        firstName: a.firstName || prev.firstName || "",
        lastName: a.lastName || prev.lastName || "",
        attributes: { ...(prev.attributes || {}), ...(a.attributes || {}) },
      });
    }

    const contacts = Array.from(map.values());
    if (contacts.length === 0) return json({ ok: true, total: 0, created: 0, updated: 0, failed: [], skipped: 0 });

    const res = await upsertContacts(contacts, Number(cfg.listId));

    return json({
      ok: true,
      sourceCounts: { auth: authContacts.length, customers: customerContacts.length },
      total: contacts.length,
      created: res.created,
      updated: res.updated,
      failed: res.failed,
    });
  } catch (e: any) {
    return json({ error: e?.message || "Sync All error" }, 500);
  }
}
