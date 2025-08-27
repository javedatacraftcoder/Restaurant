// src/app/(public)/page.tsx
"use client";
export const dynamic = "force-dynamic";

export default function HomePage() {
  return (
    <main className="container py-5">
      <h1 className="mb-4 text-primary">Proyecto Restaurante – OK</h1>
      <p className="lead">
        Etapa 0 lista: seguridad base, healthcheck y admin inicializados.
      </p>
      <ul className="list-group">
        <li className="list-group-item">
          <code>/api/health</code>
        </li>
        <li className="list-group-item">
          <code>/api/_status/firestore</code>
        </li>
      </ul>
    </main>
  );
}
