// src/app/(client)/app/layout.tsx
'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import CartBadge from '@/components/CartBadge';

export default function ClientLayout({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  const isActive = (href: string) => pathname?.startsWith(href);

  return (
    <>
      <nav className="navbar navbar-expand-md navbar-light bg-light border-bottom">
        <div className="container">
          <Link className="navbar-brand fw-semibold" href="/app">Customer Portal</Link>

          <button
            className="navbar-toggler"
            type="button"
            aria-label="Toggle navigation"
            aria-expanded={open ? 'true' : 'false'}
            onClick={() => setOpen((v) => !v)}
          >
            <span className="navbar-toggler-icon"></span>
          </button>

          <div className={`collapse navbar-collapse${open ? ' show' : ''}`}>
            <ul className="navbar-nav me-auto mb-2 mb-md-0">
              <li className="nav-item">
                <Link className={`nav-link ${isActive('/app/menu') ? 'active' : ''}`} href="/app/menu">Menú</Link>
              </li>
              <li className="nav-item">
                <Link className={`nav-link ${isActive('/cart-new') ? 'active' : ''}`} href="/cart-new">Carrito</Link>
              </li>
              <li className="nav-item">
                <Link className={`nav-link ${isActive('/app/orders') ? 'active' : ''}`} href="/app/orders">Órdenes</Link>
              </li>
              <li className="nav-item">
                <Link className={`nav-link ${isActive('/app/orders') ? 'active' : ''}`} href="/app/orders">Seguimiento</Link>
              </li>
            </ul>

            <div className="d-flex align-items-center gap-2">
              {/* CartBadge ya cuenta items con useCart */}
              <CartBadge href="/cart-new" />
              <Link className="btn btn-outline-secondary btn-sm" href="/logout">Salir</Link>
            </div>
          </div>
        </div>
      </nav>

      <main className="container py-4">{children}</main>
    </>
  );
}
