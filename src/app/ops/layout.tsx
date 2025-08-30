// src/app/ops/layout.tsx
'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function OpsLayout({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const isActive = (href: string) => pathname?.startsWith(href);

  return (
    <>
      <nav className="navbar navbar-expand-md navbar-dark bg-dark border-bottom">
        <div className="container">
          <Link className="navbar-brand fw-semibold" href="/admin">Admin Portal</Link>

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
                <Link className={`nav-link ${isActive('/admin/cashier') ? 'active' : ''}`} href="/admin/cashier">Cashier</Link>
              </li>
              <li className="nav-item">
                <Link className={`nav-link ${isActive('/admin/kitchen') ? 'active' : ''}`} href="/admin/kitchen">Kitchen</Link>
              </li>
              <li className="nav-item">
                <Link className={`nav-link ${isActive('/admin/menu') ? 'active' : ''}`} href="/admin/menu">Menú</Link>
              </li>
              <li className="nav-item">
                <Link className={`nav-link ${isActive('/admin/orders') ? 'active' : ''}`} href="/admin/orders">Órdenes</Link>
              </li>
              <li className="nav-item">
                <Link className={`nav-link ${isActive('/admin/roles') ? 'active' : ''}`} href="/admin/roles">Roles</Link>
              </li>
              <li className="nav-item">
                <Link className={`nav-link ${isActive('/ops') ? 'active' : ''}`} href="/ops">Ops</Link>
              </li>
            </ul>

            <div className="d-flex align-items-center gap-2">
              <Link className="btn btn-outline-light btn-sm" href="/logout">Salir</Link>
            </div>
          </div>
        </div>
      </nav>

      <main className="container py-4">{children}</main>
    </>
  );
}
