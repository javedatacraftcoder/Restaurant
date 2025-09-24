'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import CartBadge from '@/components/CartBadge';

// i18n
import { t, getLang } from '@/lib/i18n/t';
import { useTenantSettings } from '@/lib/settings/hooks';

export default function ClientLayout({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // idioma actual
  const { settings } = useTenantSettings();
  const rawLang =
    (settings as any)?.language ??
    (typeof window !== 'undefined' ? localStorage.getItem('tenant.language') || undefined : undefined);
  const lang = getLang(rawLang);

  const isActive = (href: string) => pathname?.startsWith(href);

  return (
    <>
      <nav className="navbar navbar-expand-md navbar-light bg-light border-bottom">
        <div className="container">
          <Link className="navbar-brand fw-semibold" href="/app">
            {t(lang, 'nav.brand')}
          </Link>

          <button
            className="navbar-toggler"
            type="button"
            aria-label={t(lang, 'nav.toggle')}
            aria-expanded={open ? 'true' : 'false'}
            onClick={() => setOpen((v) => !v)}
          >
            <span className="navbar-toggler-icon"></span>
          </button>

          <div className={`collapse navbar-collapse${open ? ' show' : ''}`}>
            <ul className="navbar-nav me-auto mb-2 mb-md-0">
              <li className="nav-item">
                <Link className={`nav-link ${isActive('/app/menu') ? 'active' : ''}`} href="/app/menu">
                  {t(lang, 'nav.menu')}
                </Link>
              </li>
              <li className="nav-item">
                <Link className={`nav-link ${isActive('/cart-new') ? 'active' : ''}`} href="/cart-new">
                  {t(lang, 'nav.cart')}
                </Link>
              </li>
              <li className="nav-item">
                <Link className={`nav-link ${isActive('/app/orders') ? 'active' : ''}`} href="/app/orders">
                  {t(lang, 'nav.orders')}
                </Link>
              </li>
              <li className="nav-item">
                <Link className={`nav-link ${isActive('/app/tracking') ? 'active' : ''}`} href="/app/tracking">
                  {t(lang, 'nav.tracking')}
                </Link>
              </li>
            </ul>

            <div className="d-flex align-items-center gap-2">
              {/* CartBadge ya cuenta items con useCart */}
              <CartBadge href="/cart-new" />
              <Link className="btn btn-outline-secondary btn-sm" href="/logout">
                {t(lang, 'nav.logout')}
              </Link>
            </div>
          </div>
        </div>
      </nav>

      <main className="container py-4">{children}</main>
    </>
  );
}
