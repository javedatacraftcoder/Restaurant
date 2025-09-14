// src/app/api/marketing/brevo/sync-auth-users/route.ts
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { json, requireAdmin, db } from "../_guard";
import { upsertContacts } from "@/lib/marketing/brevo";
import { adminAuth } from "@/lib/firebase/admin";

/** Lista todos los usuarios de Firebase Auth (paginado) */
async function listAllAuthUsers() {
  const acc: Array<{
    uid: string;
    email: string;
    displayName?: string | null;
    emailVerified?: boolean;
    disabled?: boolean;
  }> = [];

  let nextPageToken: string | undefined = undefined;
  do {
    const page = await adminAuth.listUsers(1000, nextPageToken);
    for (const u of page.users) {
      if (!u.email) continue;
      // Filtra usuarios deshabilitados
      if (u.disabled) continue;
      // ⚠️ Entregabilidad: por defecto tomamos SOLO verificados
      if (!u.emailVerified) continue;

      acc.push({
        uid: u.uid,
        email: u.email.toLowerCase(),
        displayName: u.displayName || "",
        emailVerified: u.emailVerified,
        disabled: u.disabled,
      });
    }
    nextPageToken = page.pageToken;
  } while (nextPageToken);

  return acc;
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
    // Carga config creada por /setup (folderId/listId)
    const cfgDoc = await db.collection("app_config").doc("marketing").get();
    const cfg = cfgDoc.exists ? cfgDoc.data() : null;
    if (!cfg?.listId) return json({ error: "Missing marketing listId. Run setup first." }, 400);

    // 1) Listar usuarios de Firebase Auth
    const users = await listAllAuthUsers();
    if (users.length === 0) {
      return json({ ok: true, total: 0, created: 0, updated: 0, failed: [] });
    }

    // 2) Mapear a contactos Brevo
    const contacts = users.map((u) => {
      const { firstName, lastName } = splitName(u.displayName);
      return {
        email: u.email,
        firstName,
        lastName,
        attributes: {
          UID: u.uid,
          SOURCE: "firebase_auth",
          EMAIL_VERIFIED: u.emailVerified ? "yes" : "no",
        },
      };
    });

    // 3) Upsert en Brevo list
    const res = await upsertContacts(contacts, Number(cfg.listId));

    return json({
      ok: true,
      total: contacts.length,
      created: res.created,
      updated: res.updated,
      failed: res.failed,
    });
  } catch (e: any) {
    return json({ error: e?.message || "Sync Auth error" }, 500);
  }
}
