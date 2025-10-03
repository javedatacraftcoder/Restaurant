// src/app/admin/reports/layout.tsx
'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';

// 🔤 i18n
import { t as translate } from '@/lib/i18n/t';
import { useTenantSettings } from '@/lib/settings/hooks';

const REPORT_LINKS = [
  { title: 'Taxes',     subtitle: '/reports/taxes',             href: '/admin/reports/taxes',             emoji: '📊', hint: 'Tax reports' },
  { title: 'Sales',     subtitle: '/reports/sales-reports',     href: '/admin/reports/sales-reports',     emoji: '💰', hint: 'Sales reports' },
  { title: 'Products',  subtitle: '/reports/product-reports',   href: '/admin/reports/product-reports',   emoji: '🍽️', hint: 'Product reports' },
  { title: 'Clients',   subtitle: '/reports/client-reports',    href: '/admin/reports/client-reports',    emoji: '👥', hint: 'Client reports' },
  { title: 'Promotion', subtitle: '/reports/promotion-reports', href: '/admin/reports/promotion-reports', emoji: '🏷️', hint: 'Promotions reports' },
  { title: 'Delivery',  subtitle: '/reports/delivery-reports',  href: '/admin/reports/delivery-reports',  emoji: '🛵', hint: 'Delivery reports' },
  { title: 'Cashier',   subtitle: '/reports/cashier-reports',   href: '/admin/reports/cashier-reports',   emoji: '💵', hint: 'Cashier reports' },
  { title: 'Time',      subtitle: '/reports/time-reports',      href: '/admin/reports/time-reports',      emoji: '⏰', hint: 'Time reports' },
];

export default function ReportsLayout({ children }: { children: React.ReactNode }) {
  const railRef = useRef<HTMLDivElement | null>(null);

  // 🔤 idioma actual + helper (semilla estable para SSR/hidratación)
  const { settings } = useTenantSettings();
  const [lang, setLang] = useState<string | undefined>(() => (settings as any)?.language);

  useEffect(() => {
    try {
      const ls = localStorage.getItem('tenant.language');
      setLang(ls || (settings as any)?.language);
    } catch {
      setLang((settings as any)?.language);
    }
  }, [settings]);

  const tt = (key: string, fallback: string, vars?: Record<string, unknown>) => {
    const s = translate(lang, key, vars);
    return s === key ? fallback : s;
  };

  // drag-to-scroll state (sin flechas)
  const [drag, setDrag] = useState({ active: false, startX: 0, startLeft: 0, moved: false });

  const isInteractive = (el: EventTarget | null) => {
    if (!(el instanceof HTMLElement)) return false;
    return !!el.closest('a,button,input,textarea,select,summary,[role="button"]');
  };

  const onPointerDown: React.PointerEventHandler<HTMLDivElement> = (e) => {
    // no iniciamos drag si el click fue sobre un link/botón
    if (isInteractive(e.target)) return;
    const el = railRef.current;
    if (!el) return;
    setDrag({ active: true, startX: e.clientX, startLeft: el.scrollLeft, moved: false });
  };

  const onPointerMove: React.PointerEventHandler<HTMLDivElement> = (e) => {
    const el = railRef.current;
    if (!el || !drag.active) return;
    const dx = e.clientX - drag.startX;
    if (Math.abs(dx) > 5 && !drag.moved) setDrag((d) => ({ ...d, moved: true }));
    el.scrollLeft = drag.startLeft - dx;
  };

  const endDrag: React.PointerEventHandler<HTMLDivElement> = () => {
    if (!drag.active) return;
    setDrag((d) => ({ ...d, active: false }));
  };

  // util: clave i18n derivada del slug de la ruta (último segmento del href)
  const slugKey = (href: string) => {
    const slug = href.split('/').filter(Boolean).pop() || '';
    return `admin.reports.${slug}`;
  };

  return (
    <div className="container-fluid py-3">
      <div className="container">
        <h1 className="h4 mb-3 text-center">{tt('admin.reports.title', 'Reports')}</h1>

        {/* Rail centrado sin flechas */}
        <div className="mx-auto" style={{ maxWidth: 'min(1100px, 100%)' }}>
          <div
            ref={railRef}
            role="region"
            aria-label={tt('admin.reports.shortcuts', 'Report shortcuts')}
            className="d-flex gap-2 justify-content-center"
            style={{
              overflowX: 'auto',
              WebkitOverflowScrolling: 'touch',
              scrollBehavior: 'smooth',
              padding: '8px 12px',
              scrollSnapType: 'x mandatory',
              scrollbarWidth: 'none',
              msOverflowStyle: 'none',
              cursor: drag.active ? 'grabbing' : 'grab',
              userSelect: drag.active ? 'none' : 'auto',
            }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onClickCapture={(e) => {
              // si hubo arrastre real, cancelamos click para no navegar por error
              if (drag.moved) {
                e.preventDefault();
                e.stopPropagation();
              }
            }}
            onWheel={(e) => {
              const el = railRef.current;
              if (!el) return;
              // Permite scroll horizontal con rueda vertical en desktop
              if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) el.scrollLeft += e.deltaY;
            }}
          >
            <style jsx>{`
              div::-webkit-scrollbar { display: none; }
              @media (max-width: 576px) {
                a.btn { padding-left: 12px !important; padding-right: 12px !important; }
              }
            `}</style>

            {REPORT_LINKS.map((r) => {
              const base = slugKey(r.href);
              const title = tt(`${base}.title`, r.title);
              const hint = tt(`${base}.hint`, r.hint || r.subtitle);
              return (
                <Link
                  key={r.href}
                  href={r.href}
                  className="btn btn-outline-secondary d-inline-flex align-items-center gap-2 px-3 py-2"
                  title={hint}
                  style={{
                    scrollSnapAlign: 'center',
                    whiteSpace: 'nowrap',
                    borderRadius: 9999,
                    flex: '0 0 auto',
                  }}
                >
                  <span aria-hidden="true" style={{ fontSize: 22, lineHeight: 1 }}>{r.emoji}</span>
                  <span className="fw-semibold">{title}</span>
                </Link>
              );
            })}
          </div>
        </div>
      </div>

      <div className="container mt-3">{children}</div>
    </div>
  );
}
