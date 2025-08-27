// next.config.ts
import type { NextConfig } from 'next';

const isProd = process.env.NODE_ENV === 'production';

// --- CSP para PRODUCCIÓN (estricta; sin unsafe-eval) ---
const prodCsp = [
  // Núcleo
  "default-src 'self'",
  "base-uri 'self'",

  // Scripts (Firebase / Google)
  "script-src 'self' https://www.gstatic.com https://www.googletagmanager.com https://apis.google.com https://accounts.google.com",

  // Estilos (puedes endurecer con nonces/hashes más adelante)
  "style-src 'self' 'unsafe-inline'",

  // Imágenes y fuentes
  "img-src 'self' https: data: https://*.gstatic.com https://*.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",

  // Conexiones (Auth/Firestore/Firebase + Google)
  "connect-src 'self' https://securetoken.googleapis.com https://www.googleapis.com https://identitytoolkit.googleapis.com https://firestore.googleapis.com https://*.googleapis.com https://*.firebaseio.com wss://*.firebaseio.com https://apis.google.com https://accounts.google.com https://www.gstatic.com",

  // Iframes necesarios (popup/sign-in)
  "frame-src 'self' https://*.firebaseapp.com https://*.google.com https://*.gstatic.com https://accounts.google.com https://apis.google.com",

  // Protección adicional
  "frame-ancestors 'none'",
  "form-action 'self' https://accounts.google.com",

  // Fuerza HTTPS para sub-recursos externos válidos
  "upgrade-insecure-requests",
].join('; ');

// --- CSP para DESARROLLO (relajada; permite inline/eval y HMR) ---
const devCsp = [
  "default-src 'self'",
  "base-uri 'self'",

  // Necesario para Next.js (HMR) y SDKs en dev
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: https://www.gstatic.com https://www.googletagmanager.com https://apis.google.com https://accounts.google.com",

  "style-src 'self' 'unsafe-inline'",

  // Imágenes y fuentes
  "img-src 'self' https: data: https://*.gstatic.com https://*.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",

  // HMR/WebSocket + Firebase + local + Google
  "connect-src 'self' http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:* https://securetoken.googleapis.com https://www.googleapis.com https://identitytoolkit.googleapis.com https://firestore.googleapis.com https://*.googleapis.com https://*.firebaseio.com wss://*.firebaseio.com https://apis.google.com https://accounts.google.com https://www.gstatic.com",

  // Iframes (sign-in/reCAPTCHA, etc.)
  "frame-src 'self' https://*.firebaseapp.com https://*.google.com https://*.gstatic.com https://accounts.google.com https://apis.google.com",

  "frame-ancestors 'none'",
  "form-action 'self' https://accounts.google.com",
].join('; ');

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  { key: 'Content-Security-Policy', value: isProd ? prodCsp : devCsp },
];

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Ajusta con tu dominio en producción, p.ej. "midominio.com"
      allowedOrigins: ['localhost:3000'],
      bodySizeLimit: '2mb',
    },
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
