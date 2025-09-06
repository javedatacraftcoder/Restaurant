// middleware.ts (reforzado: admin & delivery)
import { NextResponse, type NextRequest } from "next/server";
import { addPaypalToCsp } from '@/lib/security/csp'; // ajusta el alias si no usas "@/"

// --- 👇 AGREGADO: helper que fusiona la CSP existente con orígenes de PayPal ---
function withPaypalCsp(res: NextResponse) {
  try {
    const currentCsp = res.headers.get('Content-Security-Policy') || '';
    res.headers.set('Content-Security-Policy', addPaypalToCsp(currentCsp));
  } catch {
    // no-op: nunca romper la respuesta por CSP
  }
  return res;
}

// --- Ajusta aquí si tus cookies tienen nombres distintos ---
const SESSION_COOKIE_KEYS = ["session", "idToken", "auth"]; // cualquiera de estas indica sesión
const ROLE_COOKIE_KEYS = ["appRole", "role", "roles"];      // buscamos el rol principal aquí

type Role = "admin" | "kitchen" | "cashier" | "delivery";

function hasSessionCookie(req: NextRequest): boolean {
  const c = req.cookies;
  return SESSION_COOKIE_KEYS.some((k) => Boolean(c.get(k)?.value));
}

function getRole(req: NextRequest): Role | null {
  const c = req.cookies;
  for (const key of ROLE_COOKIE_KEYS) {
    const v = c.get(key)?.value?.toLowerCase();
    if (!v) continue;
    // Soportar valores como "admin", "kitchen", "cashier", "delivery"
    // o listas "admin,cashier" -> tomamos el primero
    const first = v.split(/[,\s]+/).filter(Boolean)[0];
    if (first === "admin" || first === "kitchen" || first === "cashier" || first === "delivery") {
      return first as Role;
    }
  }
  return null;
}

function isPath(pathname: string, prefix: string) {
  return pathname === prefix || pathname.startsWith(prefix + "/");
}

// --- 👇 MODIFICADO (solo agrega wrapper): ahora la redirección incluye CSP PayPal ---
function redirectToLogin(req: NextRequest) {
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("next", req.nextUrl.pathname + (req.nextUrl.search || ""));
  const res = NextResponse.redirect(url);
  return withPaypalCsp(res);
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // --- Excluir rutas públicas para evitar bucles ---
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/static") ||
    pathname.startsWith("/images") ||
    pathname.startsWith("/favicon.ico") ||
    pathname.startsWith("/robots.txt") ||
    pathname.startsWith("/sitemap.xml") ||
    pathname.match(/\.[\w]+$/) || // archivos con extensión
    pathname.startsWith("/login") ||
    pathname.startsWith("/logout") ||
    pathname.startsWith("/api/auth")
  ) {
    // 👇 AGREGADO: aplicar CSP PayPal también en respuestas "next"
    return withPaypalCsp(NextResponse.next());
  }

  const wantsAdmin = isPath(pathname, "/admin");
  const wantsDelivery = isPath(pathname, "/delivery");

  if (!wantsAdmin && !wantsDelivery) {
    // 👇 AGREGADO
    return withPaypalCsp(NextResponse.next());
  }

  // --- Requiere sesión ---
  if (!hasSessionCookie(req)) {
    return redirectToLogin(req); // ya incluye CSP PayPal
  }

  const role = getRole(req);

  // --- Validación por rol ---
  if (wantsDelivery) {
    // Solo delivery (o admin como override) pueden entrar a /delivery
    if (role === "delivery" || role === "admin") {
      // 👇 AGREGADO
      return withPaypalCsp(NextResponse.next());
    }
    // Sesión pero sin rol válido para delivery -> home
    const url = req.nextUrl.clone();
    url.pathname = "/";
    const res = NextResponse.redirect(url);
    return withPaypalCsp(res);
  }

  if (wantsAdmin) {
    // Admin total acceso
    if (role === "admin") return withPaypalCsp(NextResponse.next());

    // Kitchen solo /admin/kitchen
    if (role === "kitchen") {
      if (isPath(pathname, "/admin/kitchen")) return withPaypalCsp(NextResponse.next());
      const url = req.nextUrl.clone();
      url.pathname = "/";
      const res = NextResponse.redirect(url);
      return withPaypalCsp(res);
    }

    // Cashier solo /admin/cashier
    if (role === "cashier") {
      if (isPath(pathname, "/admin/cashier")) return withPaypalCsp(NextResponse.next());
      const url = req.nextUrl.clone();
      url.pathname = "/";
      const res = NextResponse.redirect(url);
      return withPaypalCsp(res);
    }

    // Otros roles (incluido delivery) no entran a /admin
    const url = req.nextUrl.clone();
    url.pathname = "/";
    const res = NextResponse.redirect(url);
    return withPaypalCsp(res);
  }

  // 👇 AGREGADO
  return withPaypalCsp(NextResponse.next());
}

export const config = {
  // Aplicar solo donde puede haber contenido dinámico; excluimos recursos estáticos
  matcher: ["/((?!_next|static|images|favicon.ico|robots.txt|sitemap.xml|.*\\..*).*)"],
};
