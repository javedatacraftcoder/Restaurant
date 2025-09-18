// src/app/api/admin/ai-studio/flag/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getAdminDB, FieldValue } from "@/lib/firebase/admin";
import { requireAdmin } from "@/lib/security/authz"; // valida custom claim admin

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);
    const db = getAdminDB();
    const snap = await db.doc("system_flags/ai_studio").get();
    const data = snap.exists ? snap.data() : { enabled: true };
    return NextResponse.json({ ok: true, data });
  } catch (e: any) {
    const msg = e?.message || "Unauthorized";
    const code = /unauthorized/i.test(msg) ? 401 : /forbidden/i.test(msg) ? 403 : 500;
    return NextResponse.json({ ok: false, error: msg }, { status: code });
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireAdmin(req);
    const db = getAdminDB();
    const body = await req.json();
    const enabled = !!body.enabled;
    await db
      .doc("system_flags/ai_studio")
      .set({ enabled, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return NextResponse.json({ ok: true, data: { enabled } });
  } catch (e: any) {
    const msg = e?.message || "Unauthorized";
    const code = /unauthorized/i.test(msg) ? 401 : /forbidden/i.test(msg) ? 403 : 500;
    return NextResponse.json({ ok: false, error: msg }, { status: code });
  }
}
