// src/app/page.tsx
import Link from 'next/link';
import Image from 'next/image';
import AutoRedirect from '@/components/AutoRedirect';
import HomeNavbar from '@/components/HomeNavbar';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'OrderCraft',
  description: 'Order your favorite dishes',
};

export default function HomePage() {
  return (
    <>
      <AutoRedirect />

      {/* Navbar propio del Home controlado por React (no depende de Bootstrap JS) */}
      <HomeNavbar />

      {/* HERO */}
      <header className="bg-white">
        <div className="container py-4 py-md-5">
          <div className="row g-4 align-items-center">
            <div className="col-12 col-md-6">
              <h1 className="display-6 fw-semibold mb-2">Flavors that inspire</h1>
              <p className="lead text-body-secondary mb-4">
                Order your favorite dishes with just a few touches. Fast delivery, fresh ingredients.
              </p>
              <div className="d-flex flex-wrap gap-2">
                <Link href="/menu" className="btn btn-primary btn-lg">View the Menu</Link>
                <Link href="/promos" className="btn btn-outline-secondary btn-lg">Promotions</Link>
              </div>
            </div>

            <div className="col-12 col-md-6">
              <div className="position-relative rounded-4 overflow-hidden shadow-sm">
                <Image
                  src="/hero-1.png"
                  alt="Plato principal del restaurante"
                  className="d-block w-100"
                  width={1200}
                  height={800}
                  sizes="(max-width: 768px) 100vw, 600px"
                  style={{ objectFit: 'cover', maxHeight: 420 }}
                  priority
                />
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* DESTACADOS */}
      <section className="bg-body-tertiary py-5">
        <div className="container">
          <h2 className="h4 fw-semibold mb-3">Featured</h2>
          <div className="row g-3 g-md-4">
            {[
              { src: '/featured-1.png', title: 'Entradas' },
              { src: '/featured-2.png', title: 'Platos fuertes' },
              { src: '/featured-3.png', title: 'Bebidas' },
              { src: '/featured-4.png', title: 'Postres' },
            ].map((card) => (
              <div className="col-6 col-md-3" key={card.title}>
                <Link href="/menu" className="text-decoration-none text-dark">
                  <div className="card h-100 shadow-sm">
                    <Image
                      src={card.src}
                      alt={card.title}
                      className="card-img-top"
                      width={600}
                      height={400}
                      sizes="(max-width: 768px) 50vw, 25vw"
                      style={{ objectFit: 'cover', height: 140, width: '100%' }}
                    />
                    <div className="card-body">
                      <h3 className="card-title h6 mb-0">{card.title}</h3>
                    </div>
                  </div>
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* PROMO STRIP */}
      <section className="py-5">
        <div className="container">
          <div className="row g-4 align-items-center">
            <div className="col-12 col-lg-7">
              <div className="p-4 p-md-5 rounded-4 border bg-white">
                <h2 className="h4 fw-semibold">Seasonal promotions</h2>
                <p className="text-body-secondary mb-4">
                  Discover combos, discounts, and new recipes for a limited time.
                </p>
                <Link href="/promos" className="btn btn-outline-primary">Promotions</Link>
              </div>
            </div>
            <div className="col-12 col-lg-5">
              <Image
                src="/promo-1.png"
                alt="Promoción especial"
                className="rounded-4 shadow-sm w-100"
                width={900}
                height={600}
                sizes="(max-width: 992px) 100vw, 480px"
                style={{ objectFit: 'cover', maxHeight: 280 }}
              />
            </div>
          </div>
        </div>
      </section>

      {/* ABOUT MINI */}
      <section className="bg-body-tertiary py-5">
        <div className="container">
          <div className="row g-4 align-items-center">
            <div className="col-12 col-md-6">
              <Image
                src="/about-1.png"
                alt="Nuestra cocina"
                className="rounded-4 shadow-sm w-100"
                width={1000}
                height={700}
                sizes="(max-width: 768px) 100vw, 600px"
                style={{ objectFit: 'cover', maxHeight: 340 }}
              />
            </div>
            <div className="col-12 col-md-6">
              <h2 className="h4 fw-semibold">Made with passion</h2>
              <p className="text-body-secondary">
                We cook with fresh, local ingredients. Order online and receive in minutes.
              </p>
              <div className="d-flex gap-2">
                <Link href="/menu" className="btn btn-primary">Order Now</Link>
                <Link href="/app" className="btn btn-light border">Client Area</Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="border-top py-4">
        <div className="container d-flex flex-column flex-md-row align-items-center justify-content-between gap-3">
          <div className="small text-body-secondary">
            created by <span className="fw-semibold">datacraftcoders</span>
          </div>
          <div className="d-flex gap-3 small">
            <Link href="/menu" className="link-secondary text-decoration-none">Menu</Link>
            <Link href="/promos" className="link-secondary text-decoration-none">Promotions</Link>
            <Link href="/login" className="link-secondary text-decoration-none">Sign in</Link>
            <Link href="/account" className="link-secondary text-decoration-none">Login</Link>
          </div>
        </div>
      </footer>
    </>
  );
}
