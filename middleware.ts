// middleware.ts
import { NextResponse, type NextRequest } from "next/server";

/**
 * 🔒 Protección LITE para evitar bucles:
 * - Dejamos la protección de páginas a los guards de cliente (RequireAuth/RequireAdmin).
 * - Aquí, solo protegeríamos APIs sensibles si las tuvieras (p.ej. /api/admin/*).
 *
 * Si más adelante emites una COOKIE de sesión real en el login (recomendado),
 * puedes reforzar aquí mismo el bloqueo de /app, /admin, etc. sin riesgo de loop.
 */

// 👉 Si tienes endpoints de admin/ops del lado servidor, protégelos aquí:
const PROTECTED_API_PREFIXES: string[] = [
  // "/api/admin",
  // "/api/ops",
];

function isProtectedApi(pathname: string) {
  return PROTECTED_API_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

// Si ya manejas cookie de sesión, ajusta esta función:
function hasSessionCookie(req: NextRequest) {
  const c = req.cookies;
  return Boolean(
    c.get("session")?.value ||  // ej. cookie de sesión (Firebase/Auth server)
    c.get("idToken")?.value ||  // si guardas el idToken como cookie
    c.get("auth")?.value        // fallback genérico
  );
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Solo intervenimos en APIs protegidas (páginas quedan a los guards)
  if (!isProtectedApi(pathname)) {
    return NextResponse.next();
  }

  // Si quieres bloquear estas APIs sin sesión:
  if (!hasSessionCookie(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.next();
}

/**
 * Matcher:
 * - Mantén el alcance reducido para evitar interacciones con navegación cliente.
 * - Aquí solo matcheamos TODO menos estáticos, pero como arriba filtramos por prefijos,
 *   en la práctica solo tocará /api/admin/* o lo que agregues en PROTECTED_API_PREFIXES.
 */
export const config = {
  matcher: [
    "/((?!_next|static|images|favicon.ico|robots.txt|sitemap.xml|.*\\..*).*)",
  ],
};
