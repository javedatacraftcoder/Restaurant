// src/app/api/auth/role-cookie/route.ts
import { NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebase/admin";

export const runtime = "nodejs";

type Role = "admin" | "kitchen" | "cashier" | "waiter" | "delivery" | "customer";

function claimsToRole(claims: Record<string, any>): Role {
  if (claims?.admin) return "admin";
  if (claims?.kitchen) return "kitchen";
  if (claims?.cashier) return "cashier";
  if (claims?.waiter) return "waiter";
  if (claims?.delivery) return "delivery";
  // También soporta un claim 'role' textual
  const r = String(claims?.role || "").toLowerCase();
  if (r === "admin" || r === "kitchen" || r === "cashier" || r === "waiter" || r === "delivery") {
    return r as Role;
  }
  return "customer";
}

function roleToPath(role: Role): string {
  if (role === "admin") return "/admin";
  if (role === "kitchen") return "/admin/kitchen";
  if (role === "cashier") return "/admin/cashier";
  if (role === "waiter") return "/admin/edit-orders";
  if (role === "delivery") return "/delivery";
  return "/app";
}

export async function GET(req: Request) {
  try {
    const authHeader = req.headers.get("authorization") || "";
    const m = authHeader.match(/^Bearer\s+(.+)$/i);
    if (!m) {
      return NextResponse.json({ error: "NO_TOKEN" }, { status: 401 });
    }
    const idToken = m[1];

    // Verifica el ID token emitido por Firebase
    const decoded = await adminAuth.verifyIdToken(idToken);
    const role = claimsToRole(decoded);
    const target = role === "customer" ? "/app" : "/admin"; // 👈 si hay rol, a /admin

    // Seteamos appRole para que el middleware permita/dirija correctamente
    const res = NextResponse.json({ role, target }, { headers: { "Cache-Control": "no-store" } });
    res.cookies.set("appRole", role, { path: "/", sameSite: "lax", httpOnly: false });
    return res;
  } catch (e: any) {
    console.error("[role-cookie] verify error", e);
    return NextResponse.json({ error: "INVALID_TOKEN" }, { status: 401 });
  }
}
