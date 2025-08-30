// src/app/page.tsx
import Link from 'next/link';
import Image from 'next/image';
import AutoRedirect from '@/components/AutoRedirect';

export const metadata = {
  title: 'Restaurante',
  description: 'Ordena tus platillos favoritos',
};

export default function HomePage() {
  return (
    <>
      {/* Auto-redirect por rol si hay sesión */}
      <AutoRedirect />

      {/* NAVBAR */}
      <nav className="navbar navbar-expand-md navbar-light bg-light border-bottom">
        <div className="container">
          <Link className="navbar-brand d-flex align-items-center gap-2" href="/">
            <Image src="/logo-mark.svg" alt="Logo" width={28} height={28} />
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
        <div className="container py-5">
          <div className="row align-items-center gy-4">
            <div className="col-12 col-md-6">
              <h1 className="display-5 fw-semibold">Sabores que unen</h1>
              <p className="lead text-muted">
                Ordena tus platillos favoritos y recíbelos en minutos.
              </p>
              <div className="d-flex gap-2">
                <Link href="/menu" className="btn btn-primary btn-lg">Ver menú</Link>
                <Link href="/promos" className="btn btn-outline-secondary btn-lg">Promociones</Link>
              </div>
            </div>

            <div className="col-12 col-md-6 position-relative">
              {/* /public/hero-1.jpg */}
              <Image
                src="/hero-1.png"
                alt="Platillo especial"
                className="rounded-3 shadow w-100"
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
                  objectFit: 'cover',
                }}
              />
            </div>
          </div>
        </div>
      </header>

      {/* FEATURES */}
      <section className="bg-light border-top border-bottom">
        <div className="container py-5">
          <div className="row g-4">
            <div className="col-12 col-md-4">
              <div className="card border-0 shadow-sm h-100">
                <div className="card-body">
                  <h3 className="h5">Calidad</h3>
                  <p className="text-muted mb-0">Ingredientes frescos y recetas de la casa.</p>
                </div>
              </div>
            </div>
            <div className="col-12 col-md-4">
              <div className="card border-0 shadow-sm h-100">
                <div className="card-body">
                  <h3 className="h5">Rapidez</h3>
                  <p className="text-muted mb-0">Preparamos y entregamos a tiempo.</p>
                </div>
              </div>
            </div>
            <div className="col-12 col-md-4">
              <div className="card border-0 shadow-sm h-100">
                <div className="card-body">
                  <h3 className="h5">Experiencia</h3>
                  <p className="text-muted mb-0">Una forma sencilla de ordenar.</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <footer className="py-4 text-center text-muted">
        created by datacraftcoders
      </footer>
    </>
  );
}
