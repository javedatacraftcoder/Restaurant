import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/firebase/admin";
import { getUserFromRequest } from "@/lib/server/auth";

function json(data: any, status = 200) {
  return new NextResponse(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}

async function requireAdmin(req: NextRequest) {
  const me = await getUserFromRequest(req as any);
  if (!me || (me.role !== "admin")) return null;
  return me;
}

export { json, requireAdmin, db };
