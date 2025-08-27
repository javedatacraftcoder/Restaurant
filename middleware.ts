// ./middleware.ts
import { NextRequest, NextResponse } from 'next/server';

// ⚙️ CSP dev-friendly (evita errores por inline scripts durante desarrollo).
// En producción puedes endurecerla (ver nota al final).
const buildCSP = () => {
  const connectSrc = [
    "'self'",
    // Firebase / Google Identity
    "https://*.firebaseio.com",
    "https://firestore.googleapis.com",
    "https://securetoken.googleapis.com",
    "https://identitytoolkit.googleapis.com",
    "https://www.googleapis.com",
  ];

  const csp = [
    "default-src 'self'",
    // App Router suele evitar inline; si ves errores en dev, deja 'unsafe-inline' en style.
    "script-src 'self' 'unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    `connect-src ${connectSrc.join(' ')}`,
    "font-src 'self' data:",
    "frame-src 'self' https://*.firebaseapp.com",
    "worker-src 'self' blob:",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    "frame-ancestors 'self'",
    // upgrade-insecure-requests  // (actívalo si TODO tu contenido es https)
  ].join('; ');

  return csp;
};

export function middleware(req: NextRequest) {
  // Genera/propaga x-request-id
  const incomingId = req.headers.get('x-request-id');
  const requestId = incomingId || crypto.randomUUID();

  const res = NextResponse.next({
    request: {
      headers: req.headers,
    },
  });

  res.headers.set('x-request-id', requestId);
  res.headers.set('Content-Security-Policy', buildCSP());

  // Recomendado: otras cabeceras de seguridad útiles
  res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.headers.set('X-Content-Type-Options', 'nosniff');
  res.headers.set('X-Frame-Options', 'SAMEORIGIN');
  res.headers.set('X-XSS-Protection', '0'); // moderno: confiar en CSP

  return res;
}

// Ajusta si necesitas excluir assets estáticos
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)',
  ],
};
