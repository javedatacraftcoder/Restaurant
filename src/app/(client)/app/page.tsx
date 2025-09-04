/* src/app/(client)/app/page.tsx */
export default function AppHome() {
  return (
    <section className="container py-4">
      <div className="row gy-4">
        {/* Hero */}
        <div className="col-12">
          <div className="text-center">
            <h1 className="display-6 fw-semibold mb-2">¡Bienvenido!</h1>
            <p className="lead text-body-secondary">
              Empieza viendo el <a className="link-primary" href="/app/menu">menú</a> o revisa tu{" "}
              <a className="link-secondary" href="/app/orders">historial de órdenes</a>.
            </p>

            <div className="d-flex flex-wrap justify-content-center gap-2 mt-3">
              <a href="/app/menu" className="btn btn-primary btn-lg" aria-label="Ver menú">
                Ver menú
              </a>
              <a href="/app/orders" className="btn btn-outline-secondary btn-lg" aria-label="Ver mis órdenes">
                Mis órdenes
              </a>
            </div>
          </div>
        </div>

        {/* Accesos rápidos */}
        <div className="col-12 col-md-6">
          <div className="card shadow-sm h-100">
            <div className="card-body">
              <h2 className="h5 mb-3">Accesos rápidos</h2>
              <div className="d-grid gap-2">
                <a className="btn btn-light" href="/app/cart" aria-label="Ver carrito">🛒 Ver carrito</a>
                <a className="btn btn-light" href="/app/checkout" aria-label="Ir al checkout">💳 Ir al checkout</a>
                <a className="btn btn-light" href="/app/settings" aria-label="Ir a configuración">⚙️ Configuración</a>
              </div>
            </div>
          </div>
        </div>

        {/* Seguimiento / ayuda */}
        <div className="col-12 col-md-6">
          <div className="card shadow-sm h-100">
            <div className="card-body">
              <h2 className="h5 mb-3">Seguimiento de orden</h2>
              <p className="mb-2 text-body-secondary">
                Revisa el estado de tu última orden en tiempo real.
              </p>
              <a className="btn btn-outline-primary" href="/app/tracking" aria-label="Ver seguimiento">
                Ver seguimiento
              </a>

              <hr className="my-4" />

              <h3 className="h6 text-body-secondary mb-2">¿Primera vez aquí?</h3>
              <p className="small text-body-secondary mb-0">
                Explora el menú y agrega lo que quieras al carrito. El diseño es 100% responsive.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
