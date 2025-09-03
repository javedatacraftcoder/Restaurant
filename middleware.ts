// middleware.ts (reforzado: admin & delivery)
import { NextResponse, type NextRequest } from "next/server";

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

function redirectToLogin(req: NextRequest) {
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("next", req.nextUrl.pathname + (req.nextUrl.search || ""));
  return NextResponse.redirect(url);
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
    return NextResponse.next();
  }

  const wantsAdmin = isPath(pathname, "/admin");
  const wantsDelivery = isPath(pathname, "/delivery");

  if (!wantsAdmin && !wantsDelivery) {
    return NextResponse.next();
  }

  // --- Requiere sesión ---
  if (!hasSessionCookie(req)) {
    return redirectToLogin(req);
  }

  const role = getRole(req);

  // --- Validación por rol ---
  if (wantsDelivery) {
    // Solo delivery (o admin como override) pueden entrar a /delivery
    if (role === "delivery" || role === "admin") {
      return NextResponse.next();
    }
    // Sesión pero sin rol válido para delivery -> home
    const url = req.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  if (wantsAdmin) {
    // Admin total acceso
    if (role === "admin") return NextResponse.next();

    // Kitchen solo /admin/kitchen
    if (role === "kitchen") {
      if (isPath(pathname, "/admin/kitchen")) return NextResponse.next();
      const url = req.nextUrl.clone();
      url.pathname = "/";
      return NextResponse.redirect(url);
    }

    // Cashier solo /admin/cashier
    if (role === "cashier") {
      if (isPath(pathname, "/admin/cashier")) return NextResponse.next();
      const url = req.nextUrl.clone();
      url.pathname = "/";
      return NextResponse.redirect(url);
    }

    // Otros roles (incluido delivery) no entran a /admin
    const url = req.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  // Aplicar solo donde puede haber contenido dinámico; excluimos recursos estáticos
  matcher: ["/((?!_next|static|images|favicon.ico|robots.txt|sitemap.xml|.*\\..*).*)"],
};
