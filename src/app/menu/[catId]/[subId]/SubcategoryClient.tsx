"use client";

import { useEffect, useMemo, useState } from "react";
import {
  getFirestore,
  collection,
  query,
  where,
  onSnapshot,
  getDoc,
  doc,
  getDocs,
  limit,
} from "firebase/firestore";
import Image from "next/image";
import Link from "next/link";
import { useCart } from "@/lib/cart/context"; // 👈 integra con tu carrito real

type Category = { id: string; name: string; slug?: string };
type Subcategory = { id: string; name: string; slug?: string; categoryId: string };
type MenuItem = {
  id: string;
  name: string;
  price: number;
  imageUrl?: string | null;
  // compat con tus posibles banderas:
  isAvailable?: boolean;
  active?: boolean;
  /** 👇 NUEVO: descripción opcional */
  description?: string | null;
};

function fmtQ(n?: number) {
  const v = Number.isFinite(Number(n)) ? Number(n) : 0;
  try { return new Intl.NumberFormat("es-GT", { style: "currency", currency: "GTQ" }).format(v); }
  catch { return `Q ${v.toFixed(2)}`; }
}

export default function SubcategoryClient({ catId, subId }: { catId: string; subId: string }) {
  const db = useMemo(() => getFirestore(), []);
  const [category, setCategory] = useState<Category | null>(null);
  const [subcategory, setSubcategory] = useState<Subcategory | null>(null);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [addingId, setAddingId] = useState<string | null>(null);

  // 👇 Hook del carrito (tu proveedor real)
  const { add } = useCart();

  useEffect(() => {
    const unsubList: Array<() => void> = [];
    (async () => {
      const catSnap = await getDoc(doc(db, "categories", catId));
      if (catSnap.exists()) setCategory({ id: catSnap.id, ...(catSnap.data() as any) });

      // Resuelve sub por id o, si llega slug, por slug
      let realSubId = subId;
      let subData: any | null = null;
      const byId = await getDoc(doc(db, "subcategories", subId));
      if (byId.exists()) {
        subData = byId.data();
      } else {
        const bySlug = await getDocs(
          query(collection(db, "subcategories"), where("slug", "==", subId), limit(1))
        );
        if (!bySlug.empty) {
          const d = bySlug.docs[0];
          realSubId = d.id;
          subData = d.data();
        }
      }
      if (subData) setSubcategory({ id: realSubId, ...(subData as any) });

      // Items de la subcategoría (sin orderBy, ordenamos en cliente)
      const q = query(collection(db, "menuItems"), where("subcategoryId", "==", realSubId));
      const unsub = onSnapshot(q, (s) => {
        const rows: MenuItem[] = s.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
        rows.sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
        setItems(rows);
      });
      unsubList.push(unsub);
    })();
    return () => unsubList.forEach((u) => u());
  }, [db, catId, subId]);

  // 👉 Agregar al carrito usando tu API real
  const handleAdd = (it: MenuItem) => {
    setAddingId(it.id);
    try {
      add({
        menuItemId: it.id,
        menuItemName: it.name,
        quantity: 1,
      });
    } finally {
      setAddingId(null);
    }
  };

  const isDisabled = (it: MenuItem) => it.isAvailable === false || it.active === false;

  return (
    <div className="container py-4">
      <div className="d-flex align-items-center justify-content-between mb-3">
        <div>
          <div className="text-muted small">Menú / {category?.name ?? "Categoría"}</div>
          <h1 className="h4 m-0">{subcategory?.name ?? "Subcategoría"}</h1>
        </div>
        <div className="d-flex gap-2">
          <Link href={`/menu/${catId}`} className="btn btn-sm btn-outline-secondary">← Subcategorías</Link>
          <Link href="/menu" className="btn btn-sm btn-outline-secondary">Inicio menú</Link>
        </div>
      </div>

      <div className="row g-4">
        {items.map((it) => (
          <div className="col-12 col-sm-6 col-lg-4" key={it.id}>
            <div className="card border-0 shadow-sm h-100 d-flex flex-column">
              <div className="ratio ratio-4x3 rounded-top overflow-hidden">
                {it.imageUrl ? (
                  <Image
                    src={it.imageUrl}
                    alt={it.name}
                    fill
                    sizes="(max-width: 576px) 100vw, (max-width: 992px) 50vw, 33vw"
                    className="object-fit-cover"
                  />
                ) : (
                  <div className="d-flex align-items-center justify-content-center bg-light text-muted">
                    Sin imagen
                  </div>
                )}
              </div>

              <div className="card-body d-flex flex-column">
                <div className="d-flex justify-content-between align-items-start mb-2">
                  <div className="fw-semibold">{it.name}</div>
                  <div className="fw-semibold">{fmtQ(it.price)}</div>
                </div>

                {/* 👇 NUEVO: mostrar descripción si existe */}
                {it.description && (
                  <p className="text-muted small mb-2">{it.description}</p>
                )}

                {isDisabled(it) && (
                  <div className="badge text-bg-warning mb-2 align-self-start">No disponible</div>
                )}

                <button
                  type="button"
                  className="btn btn-primary mt-auto"
                  disabled={isDisabled(it) || addingId === it.id}
                  onClick={() => handleAdd(it)}
                >
                  {addingId === it.id ? "Agregando…" : "Agregar"}
                </button>
              </div>
            </div>
          </div>
        ))}

        {items.length === 0 && (
          <div className="col-12">
            <div className="alert alert-light border">No hay platillos aún en esta subcategoría.</div>
          </div>
        )}
      </div>
    </div>
  );
}
