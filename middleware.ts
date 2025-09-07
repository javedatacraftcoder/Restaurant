// middleware.ts (reforzado: admin & delivery, sin romper Google Auth)
import { NextResponse, type NextRequest } from "next/server";
import { addPaypalToCsp } from "@/lib/security/csp"; // ajusta el alias si no usas "@/"

// --- 👇 Wrapper CSP PayPal (se aplicará solo donde NO afecte el login) ---
function withPaypalCsp(res: NextResponse) {
  try {
    const currentCsp = res.headers.get("Content-Security-Policy") || "";
    res.headers.set("Content-Security-Policy", addPaypalToCsp(currentCsp));
  } catch {
    // no-op
  }
  return res;
}

// --- Ajusta aquí si tus cookies tienen nombres distintos ---
const SESSION_COOKIE_KEYS = ["session", "idToken", "auth"]; // cualquiera de estas indica sesión
const ROLE_COOKIE_KEYS = ["appRole", "role", "roles"]; // buscamos el rol principal aquí

type Role = "admin" | "kitchen" | "cashier" | "delivery" | "waiter";

function hasSessionCookie(req: NextRequest): boolean {
  const c = req.cookies;
  return SESSION_COOKIE_KEYS.some((k) => Boolean(c.get(k)?.value));
}

function getRole(req: NextRequest): Role | null {
  const c = req.cookies;
  for (const key of ROLE_COOKIE_KEYS) {
    const v = c.get(key)?.value?.toLowerCase();
    if (!v) continue;
    const first = v.split(/[,\s]+/).filter(Boolean)[0];
    if (
      first === "admin" ||
      first === "kitchen" ||
      first === "cashier" ||
      first === "delivery" ||
      first === "waiter"
    ) {
      return first as Role;
    }
  }
  return null;
}

function isPath(pathname: string, prefix: string) {
  return pathname === prefix || pathname.startsWith(prefix + "/");
}

// Redirección a login con preservación de "next"
function redirectToLogin(req: NextRequest) {
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  // Conserva path + search original
  url.searchParams.set("next", req.nextUrl.pathname + (req.nextUrl.search || ""));
  const res = NextResponse.redirect(url);
  return withPaypalCsp(res);
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // --- 0) BYPASS TOTAL para rutas que no deben tocarse (ni con CSP) ---
  //    MUY IMPORTANTE: /login y /debug/* se devuelven "limpios" para no romper Google/Firebase
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/static") ||
    pathname.startsWith("/images") ||
    pathname.startsWith("/favicon.ico") ||
    pathname.startsWith("/robots.txt") ||
    pathname.startsWith("/sitemap.xml") ||
    pathname.match(/\.[\w]+$/) || // archivos con extensión
    pathname.startsWith("/api/auth") || // callbacks de auth si los hubiera
    pathname === "/login" ||
    pathname.startsWith("/debug/") ||
    pathname.startsWith("/auth/") ||    // páginas del flujo google
    pathname.startsWith("/api/auth") // 👈 BYPASS TOTAL para /auth/*
  ) {
    // 👇 NO modificar CSP aquí
    return NextResponse.next();
  }

  // --- 1) Rutas públicas (home, etc.) sin requerimiento de rol ---
  const wantsAdmin = isPath(pathname, "/admin");
  const wantsDelivery = isPath(pathname, "/delivery");

  if (!wantsAdmin && !wantsDelivery) {
    // En públicas, mantenemos tu política de añadir PayPal a CSP
    return withPaypalCsp(NextResponse.next());
  }

  // --- 2) Rutas protegidas por sesión ---
  if (!hasSessionCookie(req)) {
    return redirectToLogin(req); // incluye CSP PayPal en la redirección (seguro)
  }

  const role = getRole(req);

  // --- 3) Validación por rol ---
  if (wantsDelivery) {
    // Solo delivery o admin
    if (role === "delivery" || role === "admin") {
      return withPaypalCsp(NextResponse.next());
    }
    const url = req.nextUrl.clone();
    url.pathname = "/";
    const res = NextResponse.redirect(url);
    return withPaypalCsp(res);
  }

  if (wantsAdmin) {
    if (role === "admin") return withPaypalCsp(NextResponse.next());

    if (role === "kitchen") {
      if (isPath(pathname, "/admin/kitchen")) return withPaypalCsp(NextResponse.next());
      const url = req.nextUrl.clone();
      url.pathname = "/";
      return withPaypalCsp(NextResponse.redirect(url));
    }

    if (role === "cashier") {
      if (isPath(pathname, "/admin/cashier")) return withPaypalCsp(NextResponse.next());
      const url = req.nextUrl.clone();
      url.pathname = "/";
      return withPaypalCsp(NextResponse.redirect(url));
    }

    // ✅ Waiter solo /admin/edit-orders
    if (role === "waiter") {
      if (isPath(pathname, "/admin/edit-orders")) return withPaypalCsp(NextResponse.next());
      const url = req.nextUrl.clone();
      url.pathname = "/";
      return withPaypalCsp(NextResponse.redirect(url));
    }

    const url = req.nextUrl.clone();
    url.pathname = "/";
    return withPaypalCsp(NextResponse.redirect(url));
  }

  return withPaypalCsp(NextResponse.next());
}

// Mantén el matcher como lo tenías, /login entra al middleware pero lo bypass-eamos arriba.
export const config = {
  matcher: ["/((?!_next|static|images|favicon.ico|robots.txt|sitemap.xml|.*\\..*).*)"],
};
