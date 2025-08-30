// src/app/page.tsx
import Link from 'next/link';
import Image from 'next/image';

export const metadata = {
  title: 'Restaurante',
  description: 'Ordena tus platillos favoritos',
};

export default function HomePage() {
  return (
    <>
      {/* NAVBAR */}
      <nav className="navbar navbar-expand-md navbar-light bg-light border-bottom">
        <div className="container">
          <Link className="navbar-brand d-flex align-items-center gap-2" href="/">
            {/* /public/logo-mark.svg */}
            <Image src="/logo-mark.svg" alt="Restaurante" width={28} height={28} />
            <span className="fw-semibold">Restaurante</span>
          </Link>

          {/* Para que el toggle funcione, recuerda incluir el JS de Bootstrap en tu layout */}
          <button
            className="navbar-toggler"
            type="button"
            data-bs-toggle="collapse"
            data-bs-target="#mainNav"
            aria-controls="mainNav"
            aria-expanded="false"
            aria-label="Toggle navigation"
          >
            <span className="navbar-toggler-icon"></span>
          </button>

          <div className="collapse navbar-collapse" id="mainNav">
            <ul className="navbar-nav me-auto mb-2 mb-md-0">
              <li className="nav-item">
                <Link className="nav-link" href="/menu">Menú</Link>
              </li>
              <li className="nav-item">
                <Link className="nav-link" href="/promos">Promociones</Link>
              </li>
            </ul>
            <div className="d-flex gap-2">
              <Link className="btn btn-outline-primary btn-sm" href="/login">Sign in</Link>
              <Link className="btn btn-primary btn-sm" href="/account">Login</Link>
            </div>
          </div>
        </div>
      </nav>

      {/* HERO */}
      <header className="bg-white">
        <div className="container py-4 py-md-5">
          <div className="row g-4 align-items-center">
            <div className="col-12 col-md-6">
              <h1 className="display-6 fw-semibold mb-2">Sabores que inspiran</h1>
              <p className="lead text-body-secondary mb-4">
                Pide tus platillos favoritos con un par de toques. Entrega rápida, ingredientes frescos.
              </p>
              <div className="d-flex flex-wrap gap-2">
                <Link href="/menu" className="btn btn-primary btn-lg">Ver menú</Link>
                <Link href="/promos" className="btn btn-outline-secondary btn-lg">Promociones</Link>
              </div>
            </div>

            <div className="col-12 col-md-6">
              <div className="position-relative rounded-4 overflow-hidden shadow-sm">
                {/* /public/hero-1.jpg */}
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
                {/* /public/hero-2.jpg */}
                <Image
                  src="/hero-2.png"
                  alt="Bebida refrescante"
                  className="position-absolute rounded-3 shadow"
                  width={600}
                  height={800}
                  sizes="(max-width: 768px) 40vw, 240px"
                  style={{
                    right: '1rem',
                    bottom: '-1.25rem',
                    width: '40%',
                    height: 'auto',
                    border: '4px solid #fff'
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* DESTACADOS */}
      <section className="bg-body-tertiary py-5">
        <div className="container">
          <h2 className="h4 fw-semibold mb-3">Destacados</h2>
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
                <h2 className="h4 fw-semibold">Promociones de temporada</h2>
                <p className="text-body-secondary mb-4">
                  Descubre combos, descuentos y nuevas recetas por tiempo limitado.
                </p>
                <Link href="/promos" className="btn btn-outline-primary">Ver promos</Link>
              </div>
            </div>
            <div className="col-12 col-lg-5">
              {/* /public/promo-1.jpg */}
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
              {/* /public/about-1.jpg */}
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
              <h2 className="h4 fw-semibold">Hecho con pasión</h2>
              <p className="text-body-secondary">
                Cocinamos con ingredientes frescos y locales. Ordena en línea y recibe en minutos.
              </p>
              <div className="d-flex gap-2">
                <Link href="/menu" className="btn btn-primary">Ordenar ahora</Link>
                <Link href="/app" className="btn btn-light border">Área de cliente</Link>
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
            <Link href="/menu" className="link-secondary text-decoration-none">Menú</Link>
            <Link href="/promos" className="link-secondary text-decoration-none">Promociones</Link>
            <Link href="/login" className="link-secondary text-decoration-none">Sign in</Link>
            <Link href="/account" className="link-secondary text-decoration-none">Login</Link>
          </div>
        </div>
      </footer>
    </>
  );
}
