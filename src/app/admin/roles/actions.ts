// src/app/admin/roles/actions.ts
"use server";

import { adminAuth } from "@/lib/firebase/admin";

type RoleKey = "admin" | "kitchen" | "waiter" | "delivery";

async function assertAdminFromToken(idToken: string) {
  if (!idToken) throw new Error("Missing idToken");
  const decoded = await adminAuth.verifyIdToken(idToken);
  const isAdmin = decoded?.admin === true || decoded?.role === "admin";
  if (!isAdmin) throw new Error("Forbidden");
  return decoded;
}

export async function listUsersAction(args: {
  idToken: string;
  search?: string;
  nextPageToken?: string | null;
  pageSize?: number;
}) {
  const { idToken, search = "", nextPageToken = undefined, pageSize = 50 } = args || ({} as any);
  await assertAdminFromToken(idToken);

  const res = await adminAuth.listUsers(pageSize, nextPageToken || undefined);

  let users = res.users.map((u) => ({
    uid: u.uid,
    email: u.email || "",
    displayName: u.displayName || "",
    disabled: !!u.disabled,
    claims: (u.customClaims as Record<string, any>) || {},
  }));

  const q = search.trim().toLowerCase();
  if (q) {
    users = users.filter(
      (u) =>
        u.uid.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        u.displayName.toLowerCase().includes(q)
    );
  }

  return { users, nextPageToken: res.pageToken || null };
}

export async function setClaimsAction(args: {
  idToken: string;
  uid: string;
  changes: Partial<Record<RoleKey, boolean>>;
}) {
  const { idToken, uid, changes } = args || ({} as any);
  await assertAdminFromToken(idToken);

  const userRec = await adminAuth.getUser(uid);
  const current = (userRec.customClaims as Record<string, any>) || {};
  const next = { ...current, ...changes };

  await adminAuth.setCustomUserClaims(uid, next);

  return { ok: true, uid, claims: next };
}
