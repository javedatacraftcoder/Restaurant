// src/components/home/HomeClient.tsx
"use client";

import { useEffect, useState } from "react";
import { t } from "@/lib/i18n/t";
import Hero from "@/components/home/Hero";
import PromoStrip from "@/components/home/PromoStrip";
import FeaturedMenu from "@/components/home/FeaturedMenu";
import Gallery from "@/components/home/Gallery";
import AboutUs from "@/components/home/AboutUs"; // ← NUEVO

/** Tipos mínimos para las props que le pasa page.tsx */
type HeroSlide = { imageUrl: string; imageAlt?: string; headline: string; sub?: string; cta?: { label: string; href: string }; overlay?: "dark" | "light" | "none" };
type HeroVideo = { url: string; posterUrl?: string; autoplay?: boolean; loop?: boolean; muted?: boolean; blurPx?: number };
type HeroData = { variant: "image" | "carousel" | "video"; slides?: HeroSlide[]; video?: HeroVideo };
type Promo = { id: string; title: string; subtitle?: string; badge?: "primary" | "success" | "warning" | "danger" | "info"; imageUrl?: string; discountPct?: number; href?: string; menuItemIds?: string[]; couponIds?: string[]; dishes?: Array<{ id: string; name: string; imageUrl?: string; price?: number }> };
type Item = { id: string; name: string; price?: number; imageUrl?: string };

export default function HomeClient({
  serverLang,
  heroData,
  promos,
  featuredTitle,
  featuredItems,
  featuredCategories,
  galleryImages,
}: {
  serverLang: string;
  heroData: HeroData;
  promos: Promo[];
  featuredTitle?: string;
  featuredItems: Item[];
  featuredCategories: Array<{ id: string; name: string }>;
  galleryImages: Array<{ url: string; alt?: string }>;
}) {
  const [clientLang, setClientLang] = useState<string | null>(null);
  useEffect(() => {
    try { const raw = localStorage.getItem("tenant.language"); if (raw) setClientLang(raw); } catch {}
  }, []);
  const lang = clientLang || serverLang;

  // Cambia el contraste de textos al salir del hero
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 80);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  /** Navbar fijo, transparente con fondo borroso (glass) */
  const Navbar = () => (
    <nav className={`navbar navbar-expand-lg fixed-top border-0 ${scrolled ? "nav--dark" : "nav--light"}`}>
      <div className="container">
        <a className="navbar-brand fw-semibold" href="/">OrderCraft</a>

        <button
          className="navbar-toggler"
          type="button"
          data-bs-toggle="collapse"
          data-bs-target="#mainNav"
          aria-controls="mainNav"
          aria-expanded="false"
          aria-label={t(lang, "nav.toggle")}
        >
          <span className="navbar-toggler-icon" />
        </button>

        <div className="collapse navbar-collapse" id="mainNav">
          <ul className="navbar-nav me-auto mb-2 mb-lg-0">
            <li className="nav-item"><a className="nav-link" href="#promos">{t(lang, "nav.promotions")}</a></li>
            <li className="nav-item"><a className="nav-link" href="#featured">{t(lang, "nav.featured")}</a></li>
            <li className="nav-item"><a className="nav-link" href="#gallery">{t(lang, "nav.gallery")}</a></li>
            <li className="nav-item"><a className="nav-link" href="#aboutus">{t(lang, "nav.aboutus")}</a></li>
            <li className="nav-item"><a className="nav-link" href="/menu">{t(lang, "nav.menu")}</a></li>            
          </ul>
          <div className="d-flex gap-2">
            <a className="btn btn-outline-light swap-outline" href="/login">{t(lang, "nav.login")}</a>
            <a className="btn btn-primary btn-cta" href="/signup">{t(lang, "nav.signup")}</a>
          </div>
        </div>
      </div>

      {/* estilos solo del navbar */}
      <style jsx>{`
        /* Offset para anclas con navbar fijo */
        :global(html) { scroll-padding-top: 72px; }
        .navbar { z-index: 1040; transition: color .2s ease, background-color .2s ease; }

        /* ===== GLASS BACKDROP =====
           - Sobre el video (nav--light): vidrio oscuro translúcido
           - Tras hacer scroll (nav--dark): vidrio claro translúcido
        */
        .nav--light {
          background: rgba(0, 0, 0, 0.24);
          -webkit-backdrop-filter: saturate(140%) blur(10px);
          backdrop-filter: saturate(140%) blur(10px);
        }
        .nav--dark {
          background: rgba(255, 255, 255, 0.75);
          -webkit-backdrop-filter: saturate(140%) blur(10px);
          backdrop-filter: saturate(140%) blur(10px);
          border-bottom: 1px solid rgba(0,0,0,0.06);
        }

        /* Colores de texto/links en cada estado */
        .nav--light :global(.navbar-brand),
        .nav--light :global(.nav-link) {
          color: #fff !important;
          text-shadow: 0 1px 2px rgba(0,0,0,0.35);
        }
        .nav--light :global(.navbar-toggler) { border-color: rgba(255, 255, 255, 0.55); }
        .nav--light :global(.navbar-toggler-icon) { filter: invert(1) grayscale(100%); }

        .nav--dark :global(.navbar-brand),
        .nav--dark :global(.nav-link) {
          color: #212529 !important;
          text-shadow: none;
        }
        .nav--dark :global(.navbar-toggler) { border-color: rgba(0, 0, 0, 0.25); }
        .nav--dark :global(.navbar-toggler-icon) { filter: none; }

        /* Botón outline adaptativo sin cambiar clases */
        .nav--light :global(.swap-outline) { color:#fff; border-color: rgba(255,255,255,0.7); }
        .nav--light :global(.swap-outline:hover) { background: rgba(255,255,255,0.12); }
        .nav--dark :global(.swap-outline) { color:#212529; border-color: rgba(33,37,41,0.6); }
        .nav--dark :global(.swap-outline:hover) { background: rgba(33,37,41,0.06); }

        /* CTA con sombra para contraste */
        :global(.btn-cta) { box-shadow: 0 6px 16px rgba(0,0,0,0.18); }
      `}</style>
    </nav>
  );

  return (
    <>
      <Navbar />

      <main>
        <Hero data={heroData} lang={lang} />
        {promos?.length > 0 && (
          <section id="promos" aria-labelledby="promos-heading" className="py-5 border-top">
            <div className="container">
              <div className="d-flex align-items-center justify-content-between mb-3">
                <h2 id="promos-heading" className="h4 m-0">{t(lang, "home.promos.title")}</h2>
                <span className="badge bg-danger-subtle text-danger border rounded-pill px-3 py-2">
                  {t(lang, "home.promos.hot")}
                </span>
              </div>
              <PromoStrip promos={promos} lang={lang} />
            </div>
          </section>
        )}

        <section id="featured" aria-labelledby="featured-heading" className="py-5 border-top">
          <div className="container">
            <div className="d-flex flex-column flex-md-row align-items-md-center justify-content-md-between gap-2 mb-3">
              <h2 id="featured-heading" className="h4 m-0">
                {featuredTitle || t(lang, "home.featured.title")}
              </h2>
              {featuredCategories?.length > 0 && (
                <nav aria-label={t(lang, "home.featured.navAria")}>
                  <ul className="nav flex-wrap">
                    {featuredCategories.map((c) => (
                      <li key={c.id} className="nav-item">
                        <a className="nav-link px-3 py-1 rounded-pill bg-light border me-2 mb-2" href={`/menu?cat=${encodeURIComponent(c.id)}`}>
                          {c.name}
                        </a>
                      </li>
                    ))}
                  </ul>
                </nav>
              )}
            </div>

            <FeaturedMenu items={featuredItems} lang={lang} />
          </div>
        </section>

        {galleryImages?.length > 0 && (
          <section id="gallery" aria-labelledby="gallery-heading" className="py-5 border-top">
            <div className="container">
              <div className="d-flex align-items-center justify-content-between mb-3">
                <h2 id="gallery-heading" className="h4 m-0">{t(lang, "home.gallery.title")}</h2>
                <span className="text-muted small">{t(lang, "home.gallery.subtitle")}</span>
              </div>
              <Gallery images={galleryImages} />
            </div>
          </section>
        )}

        {/* ===== NUEVO: About Us ===== */}
        <section id="aboutus" className="py-5 border-top">
          <div className="container">
            <AboutUs />
          </div>
        </section>
      </main>
    </>
  );
}
