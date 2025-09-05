// src/app/menu/page.tsx
"use client";

import "@/lib/firebase/client";
import { useEffect, useMemo, useState } from "react";
import { getFirestore, collection, query, orderBy, onSnapshot } from "firebase/firestore";
import Image from "next/image";
import Link from "next/link";

type Category = {
  id: string;
  name: string;
  slug?: string;
  sortOrder?: number;
  isActive?: boolean;
  imageUrl?: string | null;
};

export default function MenuHomePage() {
  const db = useMemo(() => getFirestore(), []);
  const [categories, setCategories] = useState<Category[]>([]);

  useEffect(() => {
    const q = query(collection(db, "categories"), orderBy("sortOrder", "asc"));
    const unsub = onSnapshot(q, (snap) => {
      setCategories(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })));
    });
    return () => unsub();
  }, [db]);

  return (
    <div className="container py-4">
      <h1 className="h3 mb-3">Destacados</h1>
      <div className="row g-4">
        {categories.map((cat) => {
          const href = `/menu/${cat.id}`; // navegamos por ID
          return (
            <div className="col-12 col-md-6 col-xl-3" key={cat.id}>
              <Link href={href} className="text-decoration-none">
                <div className="card border-0 shadow-sm h-100 position-relative">
                  <div className="ratio ratio-16x9 rounded-top overflow-hidden">
                    {cat.imageUrl ? (
                      <Image
                        src={cat.imageUrl}
                        alt={cat.name}
                        fill
                        sizes="(max-width: 576px) 100vw, (max-width: 1200px) 50vw, 25vw"
                        className="object-fit-cover"
                        priority
                      />
                    ) : (
                      <div className="d-flex align-items-center justify-content-center bg-light text-muted">
                        Sin imagen
                      </div>
                    )}
                  </div>
                  <div className="card-img-overlay d-flex align-items-end p-0">
                    <div className="w-100 bg-white px-3 py-3 border-top">
                      <div className="fw-semibold text-dark">{cat.name}</div>
                    </div>
                  </div>
                </div>
              </Link>
            </div>
          );
        })}

        {categories.length === 0 && (
          <div className="col-12">
            <div className="alert alert-light border">Aún no hay categorías.</div>
          </div>
        )}
      </div>
    </div>
  );
}
