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
  { title: "Taxes",     subtitle: "/reports/taxes",     href: "/admin/reports/taxes",     emoji: "📊", hint: "Tax reports" },
  { title: "Sales",     subtitle: "/reports/sales-reports",     href: "/admin/reports/sales-reports",     emoji: "💰", hint: "Sales reports" },
  { title: "Products",     subtitle: "/reports/product-reports",     href: "/admin/reports/product-reports",     emoji: "🍽️", hint: "Product reports" },
  { title: "Clients",     subtitle: "/reports/client-reports",     href: "/admin/reports/client-reports",     emoji: "👥", hint: "Client reports" },
  { title: "Promotion",     subtitle: "/reports/promotion-reports",     href: "/admin/reports/promotion-reports",     emoji: "🏷️", hint: "Promotions reports" },
  { title: "Delivery",     subtitle: "/reports/delivery-reports",     href: "/admin/reports/delivery-reports",     emoji: "🛵", hint: "Delivery reports" },
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
                <h1 className="h3 m-0 fw-semibold">Admin panel</h1>
                <p className="m-0 mt-2 admin-subtle" style={{ color: "rgba(255,255,255,.85)" }}>
                  Quickly access management tools.
                </p>
              </div>
              <div className="d-flex flex-wrap gap-2">
                <span className="admin-chip">🔐 Only Admin</span>
                <span className="admin-chip">⚡ Quick access</span>
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
                          <span className="text-primary fw-semibold">Open</span>
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
