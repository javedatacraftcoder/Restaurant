// next.config.ts
import type { NextConfig } from 'next';

const isProd = process.env.NODE_ENV === 'production';

// --- CSP para PRODUCCIÓN (más permisiva con inline scripts) ---
const prodCsp = [
  "default-src 'self'",
  "base-uri 'self'",
  // 👇 aquí agregamos 'unsafe-inline'
  // 👇 AGREGADO PayPal: https://www.paypal.com
  // 👇 AGREGADO Turnstile: https://challenges.cloudflare.com
  "script-src 'self' 'unsafe-inline' https://www.gstatic.com https://www.googletagmanager.com https://apis.google.com https://accounts.google.com https://www.paypal.com https://challenges.cloudflare.com",
  // 👇 AGREGADO PayPal: script-src-elem explícito (evita fallback)
  // 👇 AGREGADO Turnstile: https://challenges.cloudflare.com
  "script-src-elem 'self' 'unsafe-inline' https://www.gstatic.com https://www.googletagmanager.com https://apis.google.com https://accounts.google.com https://www.paypal.com https://challenges.cloudflare.com",
  "style-src 'self' 'unsafe-inline'",
  // 👇 AGREGADO PayPal imágenes/recursos
  // 👇 ➕ AGREGADO YouTube/Vimeo thumbnails: i.ytimg.com, i.vimeocdn.com
  "img-src 'self' https: data: https://*.gstatic.com https://*.googleapis.com https://www.paypalobjects.com https://www.paypal.com https://www.sandbox.paypal.com https://i.ytimg.com https://i.vimeocdn.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  // 👇 AGREGADO PayPal conexiones (XHR/fetch)
  "connect-src 'self' https://securetoken.googleapis.com https://www.googleapis.com https://identitytoolkit.googleapis.com https://firestore.googleapis.com https://*.googleapis.com https://*.firebaseio.com wss://*.firebaseio.com https://apis.google.com https://accounts.google.com https://www.gstatic.com https://www.paypal.com https://www.sandbox.paypal.com",
  // 👇 AGREGADO PayPal iframes
  // 👇 AGREGADO Turnstile: https://challenges.cloudflare.com
  // 👇 ➕ AGREGADO YouTube/Vimeo iframes: www.youtube.com, youtube-nocookie.com, player.vimeo.com
  "frame-src 'self' https://*.firebaseapp.com https://*.google.com https://*.gstatic.com https://accounts.google.com https://apis.google.com https://www.paypal.com https://www.sandbox.paypal.com https://challenges.cloudflare.com https://www.youtube.com https://www.youtube-nocookie.com https://player.vimeo.com",
  "frame-ancestors 'none'",
  "form-action 'self' https://accounts.google.com",
  // 👇 ➕ Recomendado para reproducir MP4 desde Firebase Storage
  "media-src 'self' blob: https://firebasestorage.googleapis.com",
  "upgrade-insecure-requests",
].join('; ');

// --- CSP para DESARROLLO (relajada) ---
const devCsp = [
  "default-src 'self'",
  "base-uri 'self'",
  // 👇 AGREGADO PayPal en script-src
  // 👇 AGREGADO Turnstile: https://challenges.cloudflare.com
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: https://www.gstatic.com https://www.googletagmanager.com https://apis.google.com https://accounts.google.com https://www.paypal.com https://challenges.cloudflare.com",
  // 👇 AGREGADO PayPal: script-src-elem explícito
  // 👇 AGREGADO Turnstile: https://challenges.cloudflare.com
  "script-src-elem 'self' 'unsafe-inline' 'unsafe-eval' blob: https://www.gstatic.com https://www.googletagmanager.com https://apis.google.com https://accounts.google.com https://www.paypal.com https://challenges.cloudflare.com",
  "style-src 'self' 'unsafe-inline'",
  // 👇 AGREGADO PayPal imágenes/recursos
  // 👇 ➕ AGREGADO YouTube/Vimeo thumbnails: i.ytimg.com, i.vimeocdn.com
  "img-src 'self' https: data: https://*.gstatic.com https://*.googleapis.com https://www.paypalobjects.com https://www.paypal.com https://www.sandbox.paypal.com https://i.ytimg.com https://i.vimeocdn.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  // 👇 AGREGADO PayPal conexiones
  "connect-src 'self' http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:* https://securetoken.googleapis.com https://www.googleapis.com https://identitytoolkit.googleapis.com https://firestore.googleapis.com https://*.googleapis.com https://*.firebaseio.com wss://*.firebaseio.com https://apis.google.com https://accounts.google.com https://www.gstatic.com https://www.paypal.com https://www.sandbox.paypal.com",
  // 👇 AGREGADO PayPal iframes
  // 👇 AGREGADO Turnstile: https://challenges.cloudflare.com
  // 👇 ➕ AGREGADO YouTube/Vimeo iframes
  "frame-src 'self' https://*.firebaseapp.com https://*.google.com https://*.gstatic.com https://accounts.google.com https://apis.google.com https://www.paypal.com https://www.sandbox.paypal.com https://challenges.cloudflare.com https://www.youtube.com https://www.youtube-nocookie.com https://player.vimeo.com",
  "frame-ancestors 'none'",
  "form-action 'self' https://accounts.google.com",
  // 👇 ➕ Recomendado para reproducir MP4 desde Firebase Storage en dev
  "media-src 'self' blob: https://firebasestorage.googleapis.com",
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
  //dynamicIO: true,
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "firebasestorage.googleapis.com" },
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
      // 👇 ➕ Thumbnails de YouTube y Vimeo si llegas a usarlos con next/image
      { protocol: "https", hostname: "i.ytimg.com" },
      { protocol: "https", hostname: "i.vimeocdn.com" },
    ],
    // Alternativa:
    // domains: ["firebasestorage.googleapis.com", "lh3.googleusercontent.com", "i.ytimg.com", "i.vimeocdn.com"],
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
