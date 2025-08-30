// ./middleware.ts
import { NextRequest, NextResponse } from 'next/server';

/**
 * CSP dev-friendly: durante desarrollo permitimos 'unsafe-inline'/'unsafe-eval'
 * para evitar errores con scripts/estilos embebidos de Next/Firebase.
 * En producción puedes endurecer (quitar 'unsafe-*' y agregar nonces/hashes).
 */
const buildCSP = () => {
  const isProd = process.env.NODE_ENV === 'production';

  // Conexiones necesarias (Firebase / Google Identity / APIs)
  const connectSrc = [
    "'self'",
    'https://*.firebaseio.com',
    'https://firestore.googleapis.com',
    'https://securetoken.googleapis.com',
    'https://identitytoolkit.googleapis.com',
    'https://www.googleapis.com',
  ];

  const imgSrc = ["'self'", 'data:', 'blob:', 'https:'];

  const scriptSrc = isProd ? ["'self'"] : ["'self'", "'unsafe-inline'", "'unsafe-eval'"];
  const styleSrc  = isProd ? ["'self'"] : ["'self'", "'unsafe-inline'"];
  const fontSrc   = ["'self'", 'data:'];
  const frameSrc  = ["'self'"]; // agrega dominios si incrustas iframes de terceros

  const directives = [
    `default-src 'self';`,
    `base-uri 'self';`,
    `form-action 'self';`,
    `connect-src ${connectSrc.join(' ')};`,
    `img-src ${imgSrc.join(' ')};`,
    `script-src ${scriptSrc.join(' ')};`,
    `style-src ${styleSrc.join(' ')};`,
    `font-src ${fontSrc.join(' ')};`,
    `frame-src ${frameSrc.join(' ')};`,
    `frame-ancestors 'self';`,
    // `upgrade-insecure-requests;`, // opcional en prod
  ];

  return directives.join(' ');
};

export function middleware(req: NextRequest) {
  /**
   * --- Control de acceso por rol (cliente vs. operativo) ---
   * Leemos la cookie 'appRole' que fija /api/auth/refresh-role.
   * Si un usuario SIN rol operativo entra a /admin|/kitchen|... -> /app (área cliente).
   * Si un operador entra a /app -> /admin (ajusta si tu home operativo difiere).
   */
  const OP_PATHS = ['/admin', '/kitchen', '/waiter', '/delivery', '/cashier', '/ops']; // ← added /ops
  const isOpPath = OP_PATHS.some((p) => req.nextUrl.pathname.startsWith(p));
  const isClientPath = req.nextUrl.pathname.startsWith('/app');

  const opRoles = new Set(['admin', 'kitchen', 'waiter', 'delivery', 'cashier']);
  const role = req.cookies.get('appRole')?.value ?? 'customer';
  const isOp = opRoles.has(role);

  const to = (path: string) => {
    const url = req.nextUrl.clone();
    url.pathname = path;
    url.search = '';
    return url;
  };

  // No operador intentando entrar a áreas operativas → /app
  if (isOpPath && !isOp) {
    return NextResponse.redirect(to('/app'));
  }

  // Operador intentando entrar al área de cliente → /admin (o tu home operativo)
  if (isClientPath && isOp) {
    return NextResponse.redirect(to('/admin'));
  }

  // Continuar request normal y añadir cabeceras de seguridad
  const res = NextResponse.next();

  // --- CSP (Content-Security-Policy) ---
  res.headers.set('Content-Security-Policy', buildCSP());

  // Cabeceras de seguridad complementarias
  res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.headers.set('X-Content-Type-Options', 'nosniff');
  res.headers.set('X-Frame-Options', 'SAMEORIGIN');
  res.headers.set('X-XSS-Protection', '0'); // deprecado, confiamos en CSP

  // Permissions-Policy minimal (ajusta si tu app usa sensores/medios)
  res.headers.set(
    'Permissions-Policy',
    [
      'accelerometer=()',
      'camera=()',
      'geolocation=()',
      'gyroscope=()',
      'magnetometer=()',
      'microphone=()',
      'payment=()',
      'usb=()',
    ].join(', ')
  );

  return res;
}

/**
 * Matcher: excluye assets estáticos de Next para no sobrecargar la cadena de peticiones.
 */
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)'],
};
