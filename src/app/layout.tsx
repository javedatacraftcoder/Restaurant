// src/app/layout.tsx
import type { Metadata } from "next";
import "@/lib/firebase/client"; // inicializa Firebase en el cliente (SSR-seguro)
// 👇 Usa el wrapper que ya incluye AuthProvider + CartProvider
import Providers from "./providers";
import AuthButtons from "@/components/AuthButtons";
import CartBadge from "@/components/CartBadge";
import Link from "next/link";
// ⬅️ al tope del archivo
import "bootstrap/dist/css/bootstrap.min.css";


export const metadata: Metadata = {
  title: "Proyecto Restaurante",
  description: "Ops KDS / Mesero / Delivery + Cliente",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body style={{ margin: 0, fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif" }}>
        <Providers>
          <header
            style={{
              position: "sticky",
              top: 0,
              zIndex: 10,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "12px 16px",
              borderBottom: "1px solid #eee",
              background: "#fff",
            }}
          >
            <Link href="/" style={{ fontWeight: 600, textDecoration: "none", color: "inherit" }}>
              🍴 Restaurante
            </Link>

            <nav style={{ display: "flex", alignItems: "center", gap: 12 }}>
              {/* Enlaces útiles para pruebas desde la web */}
              <Link href="/menu" style={{ textDecoration: "none", color: "#111" }}>
                Menú
              </Link>
              <Link href="/cart" style={{ textDecoration: "none", color: "#111" }}>
                Carrito
              </Link>
              <Link href="/ops" style={{ textDecoration: "none", color: "#111" }}>
                Operación
              </Link>
              <Link href="/playground/order" style={{ textDecoration: "none", color: "#111" }}>
                Playground
              </Link>

              {/* UI actual */}
              <AuthButtons />
              <CartBadge />
            </nav>
          </header>

          <main>{children}</main>
        </Providers>
      </body>
    </html>
  );
}
