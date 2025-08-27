// next.config.ts
import type { NextConfig } from 'next';

const isProd = process.env.NODE_ENV === 'production';

// --- CSP para PRODUCCIÓN (estricta; sin unsafe-eval) ---
const prodCsp = [
  "default-src 'self'",
  "base-uri 'self'",
  "script-src 'self' https://www.gstatic.com https://www.googletagmanager.com https://apis.google.com https://accounts.google.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' https: data: https://*.gstatic.com https://*.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "connect-src 'self' https://securetoken.googleapis.com https://www.googleapis.com https://identitytoolkit.googleapis.com https://firestore.googleapis.com https://*.googleapis.com https://*.firebaseio.com wss://*.firebaseio.com https://apis.google.com https://accounts.google.com https://www.gstatic.com",
  "frame-src 'self' https://*.firebaseapp.com https://*.google.com https://*.gstatic.com https://accounts.google.com https://apis.google.com",
  "frame-ancestors 'none'",
  "form-action 'self' https://accounts.google.com",
  "upgrade-insecure-requests",
].join('; ');

// --- CSP para DESARROLLO (relajada) ---
const devCsp = [
  "default-src 'self'",
  "base-uri 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: https://www.gstatic.com https://www.googletagmanager.com https://apis.google.com https://accounts.google.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' https: data: https://*.gstatic.com https://*.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "connect-src 'self' http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:* https://securetoken.googleapis.com https://www.googleapis.com https://identitytoolkit.googleapis.com https://firestore.googleapis.com https://*.googleapis.com https://*.firebaseio.com wss://*.firebaseio.com https://apis.google.com https://accounts.google.com https://www.gstatic.com",
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
  // 👇 Workaround para bug de clientReferenceManifest en Vercel
  output: "standalone",

  experimental: {
    ppr: false, // 🚨 Desactiva Partial Prerendering
    serverActions: {
      allowedOrigins: ['localhost:3000'],
      bodySizeLimit: '2mb',
    },
  },

  // 👇 Workaround para evitar que Vercel intente prerender con CSS chunks
  generateEtags: false,
  trailingSlash: false,
  compress: true,

  eslint: {
    ignoreDuringBuilds: true, // Ignora ESLint en Vercel
  },
  typescript: {
    ignoreBuildErrors: true, // Ignora errores TS en Vercel
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
