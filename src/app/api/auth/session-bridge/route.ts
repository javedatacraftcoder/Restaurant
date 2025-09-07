// src/app/api/auth/session-bridge/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../[...nextauth]/route";
import { adminAuth } from "@/lib/firebase/admin";

export const runtime = "nodejs";

type Role = "admin" | "kitchen" | "cashier" | "delivery" | "waiter" | "customer";

function claimsToRole(claims: Record<string, any>): Role {
  // Prioridad alineada con tu navegación (middleware soporta estos roles)
  if (claims?.admin) return "admin";
  if (claims?.kitchen) return "kitchen";
  if (claims?.cashier) return "cashier";
  if (claims?.delivery) return "delivery";
  if (claims?.waiter || (typeof claims?.role === "string" && claims.role.toLowerCase() === "waiter")) {
    return "waiter";
  }
  return "customer";
}

function roleToDefaultPath(role: Role): string {
  switch (role) {
    case "admin":
      return "/admin";
    case "kitchen":
      return "/admin/kitchen";
    case "cashier":
      return "/admin/cashier";
    case "delivery":
      return "/delivery";
    case "waiter":
      return "/admin/edit-orders";
    default:
      return "/app";
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const nextParam = url.searchParams.get("next") || "/app";

  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    const back = new URL("/login", req.url);
    back.searchParams.set("next", nextParam);
    return NextResponse.redirect(back);
  }

  // token.sub fue copiado a session.user.id en callbacks
  const providerSub = (session.user as any)?.id as string | undefined;
  if (!providerSub) {
    const back = new URL("/login", req.url);
    back.searchParams.set("next", nextParam);
    return NextResponse.redirect(back);
  }

  const uid = `google:${providerSub}`;

  // Lee claims actuales del usuario (setCustomUserClaims que manejas en tu app)
  let role: Role = "customer";
  try {
    const rec = await adminAuth.getUser(uid);
    role = claimsToRole(rec.customClaims || {});
  } catch {
    // Si no existe aún, lo tratamos como customer
    role = "customer";
  }

  // Si no hay rol especial, respetamos ?next=; si hay rol, lo mandamos a su área
  const target = role === "customer" ? nextParam : roleToDefaultPath(role);

  const redirectTo = new URL(
    `/auth/firebase/complete?next=${encodeURIComponent(target)}`,
    req.url
  );

  const res = NextResponse.redirect(redirectTo);

  // Cookies que usa tu middleware
  res.cookies.set("session", "1", {
    path: "/",
    httpOnly: false,
    sameSite: "lax",
  });
  res.cookies.set("appRole", role, {
    path: "/",
    httpOnly: false,
    sameSite: "lax",
  });

  return res;
}
