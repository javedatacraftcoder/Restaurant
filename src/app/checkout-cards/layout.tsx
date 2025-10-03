// src/app/(client)/app/layout.tsx
'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import CartBadge from '@/components/CartBadge';

/* 🔤 i18n */
import { t as translate } from '@/lib/i18n/t';
import { useTenantSettings } from '@/lib/settings/hooks';

/* --------------------------------------------
   🔤 Helper i18n (igual al patrón usado en Checkout)
--------------------------------------------- */
function useLangTT() {
  const { settings } = useTenantSettings();
  const lang = React.useMemo(() => {
    try {
      if (typeof window !== 'undefined') {
        const ls = localStorage.getItem('tenant.language');
        if (ls) return ls;
      }
    } catch {}
    return (settings as any)?.language;
  }, [settings]);
  const tt = (key: string, fallback: string, vars?: Record<string, unknown>) => {
    const s = translate(lang, key, vars);
    return s === key ? fallback : s;
  };
  return { lang, tt } as const;
}

export default function ClientLayout({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const { tt } = useLangTT();

  const isActive = (href: string) => pathname?.startsWith(href);

  return (
    <>
      <nav className="navbar navbar-expand-md navbar-light bg-light border-bottom">
        <div className="container">
          <Link className="navbar-brand fw-semibold" href="/app">
            {tt('client.nav.brand', 'Customer Portal')}
          </Link>

          <button
            className="navbar-toggler"
            type="button"
            aria-label={tt('client.nav.toggleAria', 'Toggle navigation')}
            aria-expanded={open ? 'true' : 'false'}
            onClick={() => setOpen((v) => !v)}
          >
            <span className="navbar-toggler-icon"></span>
          </button>

          <div className={`collapse navbar-collapse${open ? ' show' : ''}`}>
            <ul className="navbar-nav me-auto mb-2 mb-md-0">
              <li className="nav-item">
                <Link className={`nav-link ${isActive('/app/menu') ? 'active' : ''}`} href="/app/menu">
                  {tt('client.nav.menu', 'Menu')}
                </Link>
              </li>
              <li className="nav-item">
                <Link className={`nav-link ${isActive('/cart-new') ? 'active' : ''}`} href="/cart-new">
                  {tt('client.nav.cart', 'Cart')}
                </Link>
              </li>
              <li className="nav-item">
                <Link className={`nav-link ${isActive('/app/orders') ? 'active' : ''}`} href="/app/orders">
                  {tt('client.nav.orders', 'Orders')}
                </Link>
              </li>
              <li className="nav-item">
                <Link className={`nav-link ${isActive('/app/tracking') ? 'active' : ''}`} href="/app/tracking">
                  {tt('client.nav.tracking', 'Tracking')}
                </Link>
              </li>
            </ul>

            <div className="d-flex align-items-center gap-2">
              {/* CartBadge ya cuenta items con useCart */}
              <CartBadge href="/cart-new" />
              <Link className="btn btn-outline-secondary btn-sm" href="/logout">
                {tt('client.nav.logout', 'Logout')}
              </Link>
            </div>
          </div>
        </div>
      </nav>

      <main className="container py-4">{children}</main>
    </>
  );
}
