// src/app/admin/page.tsx
import Protected from "@/components/Protected";
import AdminOnly from "@/components/AdminOnly";
import Link from "next/link";
import React from "react";

type AdminTile = {
  title: string;
  subtitle?: string;
  href: string;
  emoji: string;
  hint?: string;
};

const TILES: AdminTile[] = [
  { title: "Kitchen",     subtitle: "admin/kitchen",     href: "/admin/kitchen",     emoji: "🍳", hint: "Comandas y estado de cocina" },
  { title: "Cashier",     subtitle: "admin/cashier",     href: "/admin/cashier",     emoji: "💵", hint: "Cobro, recibos y cierre" },
  { title: "Delivery",    subtitle: "admin/delivery",    href: "/admin/delivery",    emoji: "🚚", hint: "Asignación y seguimiento" },
  { title: "Menu",        subtitle: "admin/menu",        href: "/admin/menu",        emoji: "📋", hint: "Categorías, subcategorías y platos" },
  { title: "Orders",      subtitle: "admin/orders",      href: "/admin/orders",      emoji: "🧾", hint: "Listado y detalles de órdenes" },
  { title: "Edit Orders", subtitle: "admin/edit-orders", href: "/admin/edit-orders", emoji: "✏️", hint: "Editar órdenes existentes" },
  { title: "Roles",       subtitle: "admin/roles",       href: "/admin/roles",       emoji: "👥", hint: "Gestión de permisos y personal" },
  { title: "OPS",         subtitle: "admin/ops",         href: "/admin/ops",         emoji: "🛠️", hint: "Operaciones y herramientas" },
  { title: "Promotions",  subtitle: "admin/promotions",  href: "/admin/promotions",  emoji: "🎟️", hint: "Códigos y condiciones de descuento" },
];

export default function AdminPage() {
  return (
    <Protected>
      <AdminOnly>
        <main className="container py-4">
          <style>{`
            .admin-hero {
              background: linear-gradient(135deg, #0d6efd 0%, #6f42c1 60%, #d63384 100%);
              border-radius: 18px;
              color: #fff;
            }
            .admin-card {
              border: none;
              border-radius: 16px;
              transition: transform .15s ease, box-shadow .15s ease, background-color .2s ease;
              background: #fff;
            }
            .admin-card:hover {
              transform: translateY(-2px);
              box-shadow: 0 10px 24px rgba(16,24,40,.08);
            }
            .admin-emoji {
              font-size: 2rem;
              line-height: 1;
              width: 48px;
              height: 48px;
              display: inline-flex;
              align-items: center;
              justify-content: center;
              border-radius: 12px;
              background: rgba(13,110,253,.08);
            }
            .admin-link {
              text-decoration: none;
              color: inherit;
            }
            .admin-subtle {
              color: #6c757d;
            }
            .admin-chip {
              display: inline-flex;
              align-items: center;
              gap: .4rem;
              background: rgba(255,255,255,.2);
              border: 1px solid rgba(255,255,255,.35);
              color: #fff;
              padding: .3rem .6rem;
              border-radius: 999px;
              backdrop-filter: blur(2px);
            }
          `}</style>

          {/* Encabezado */}
          <section className="admin-hero p-4 p-md-5 mb-4 shadow-sm">
            <div className="d-flex flex-column flex-md-row align-items-md-center justify-content-between gap-3">
              <div>
                <h1 className="h3 m-0 fw-semibold">Panel Admin</h1>
                <p className="m-0 mt-2 admin-subtle" style={{ color: "rgba(255,255,255,.85)" }}>
                  Accede rápidamente a las herramientas de administración.
                </p>
              </div>
              <div className="d-flex flex-wrap gap-2">
                <span className="admin-chip">🔐 Solo Admin</span>
                <span className="admin-chip">⚡ Accesos rápidos</span>
              </div>
            </div>
          </section>

          {/* Cuadrícula de accesos */}
          <section>
            <div className="row g-3 g-md-4">
              {TILES.map((t) => (
                <div key={t.href} className="col-12 col-sm-6 col-lg-4 col-xxl-3">
                  <Link href={t.href} className="admin-link">
                    <div className="card admin-card h-100 shadow-sm">
                      <div className="card-body d-flex flex-column gap-3">
                        <div className="d-flex align-items-center gap-3">
                          <div className="admin-emoji" aria-hidden>{t.emoji}</div>
                          <div>
                            <div className="h5 m-0">{t.title}</div>
                            <div className="small text-muted">{t.subtitle}</div>
                          </div>
                        </div>
                        {t.hint && <p className="mb-0 admin-subtle">{t.hint}</p>}
                        <div className="mt-auto d-flex justify-content-between align-items-center">
                          <span className="text-primary fw-semibold">Abrir</span>
                          <span aria-hidden>↗</span>
                        </div>
                      </div>
                    </div>
                  </Link>
                </div>
              ))}
            </div>
          </section>
        </main>
      </AdminOnly>
    </Protected>
  );
}
