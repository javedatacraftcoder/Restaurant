// src/lib/security/csp.ts

/**
 * Genera el valor del header Content-Security-Policy.
 * - En dev agrega localhost/127.0.0.1 y WS para emuladores/hmr.
 * - Incluye los endpoints necesarios para Firebase Auth + Firestore.
 * - En prod puedes quitar 'unsafe-eval' si no usas librerías que lo requieran.
 */
export function buildCSP({ isDev = false }: { isDev?: boolean } = {}) {
  const connectSrc = [
    "'self'",
    "https://securetoken.googleapis.com",
    "https://www.googleapis.com",
    "https://identitytoolkit.googleapis.com",
    "https://firestore.googleapis.com",
    "https://*.googleapis.com",
    "https://*.firebaseio.com",
    "wss://*.firebaseio.com",
  ];

  if (isDev) {
    connectSrc.push(
      "http://localhost:*",
      "http://127.0.0.1:*",
      "ws://localhost:*",
      "ws://127.0.0.1:*"
    );
  }

  const directives = [
    `default-src 'self'`,
    `base-uri 'self'`,
    `img-src 'self' data: https://*.gstatic.com https://*.googleapis.com`,
    // Nota: 'unsafe-inline' y 'unsafe-eval' facilitan dev. En prod, intenta remover 'unsafe-eval'.
    `script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.gstatic.com https://www.googletagmanager.com`,
    `style-src 'self' 'unsafe-inline'`,
    `connect-src ${connectSrc.join(" ")}`,
    `frame-src https://*.firebaseapp.com https://*.google.com https://*.gstatic.com`,
    `font-src 'self' data:`,
    `form-action 'self'`,
    `frame-ancestors 'self'`,
  ];

  return directives.join("; ");
}
