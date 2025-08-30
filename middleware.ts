// middleware.ts
import { NextResponse, type NextRequest } from "next/server";

/**
 * Rutas que deben requerir sesión.
 * Puedes agregar/quitar prefijos según tu estructura.
 */
const PROTECTED_PREFIXES = [
  "/app",       // portal del cliente
  "/menu",      // menú del cliente
  "/checkout",  // checkout
  "/cart",      // carrito
  "/admin",     // admin
  "/ops",       // tableros operativos si aplica
];

/**
 * Intenta detectar una cookie de sesión.
 * Ajusta los nombres si ya usas otro cookie name en tu login.
 */
function hasSessionCookie(req: NextRequest) {
  const cookies = req.cookies;
  return Boolean(
    cookies.get("session")?.value ||   // cookie típica de sesión (Firebase/Auth server)
    cookies.get("idToken")?.value ||   // si guardas el idToken como cookie
    cookies.get("auth")?.value         // fallback genérico
  );
}

function isProtectedPath(pathname: string) {
  return PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  // Rutas públicas explícitas (no deben redirigir):
  const PUBLIC_PATHS = ["/login", "/signup", "/reset-password"];
  if (PUBLIC_PATHS.includes(pathname)) {
    return NextResponse.next();
  }

  // No proteger archivos estáticos, API ni assets; eso se controla con config.matcher
  // Aquí solo queda la protección de páginas.
  const needsAuth = isProtectedPath(pathname);
  if (!needsAuth) {
    return NextResponse.next();
  }

  // Verificamos cookie de sesión
  if (!hasSessionCookie(req)) {
    const url = new URL("/login", req.url);
    // Conserva hacia dónde quería ir el usuario
    const nextParam = pathname + (search || "");
    url.searchParams.set("next", nextParam);
    return NextResponse.redirect(url);
  }

  // (Opcional) Si quisieras forzar 2FA/otros checks, aquí es el lugar.

  return NextResponse.next();
}

/**
 * Matcher:
 *  - Aplica a TODO excepto:
 *    - /_next/* (assets internos)
 *    - /static/*, /images/* y archivos con extensión (.*\..*)
 *    - /api/* (si quieres proteger APIs por cookie, elimina "api" del negativo)
 *    - robots.txt, sitemap.xml, favicon.ico
 */
export const config = {
  matcher: [
    // Cubre todo menos _next, api y archivos estáticos o con extensión
    "/((?!_next|api|static|images|favicon.ico|robots.txt|sitemap.xml|.*\\..*).*)",
  ],
};
