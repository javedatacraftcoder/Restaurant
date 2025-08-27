// src/app/admin/catalog/catalog.tsx
"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/app/providers";

// --- helpers ---
async function apiFetch(path: string, init?: RequestInit) {
  const res = await fetch(path, { cache: "no-store", ...init });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data;
}

async function apiFetchAuth(path: string, init: RequestInit = {}, idToken?: string | null) {
  const base: HeadersInit = { "content-type": "application/json" };
  const headers: HeadersInit = {
    ...base,
    ...(init.headers || {}),
    ...(idToken ? { authorization: `Bearer ${idToken}` } : {}),
  };
  const res = await fetch(path, { cache: "no-store", ...init, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data;
}

export default function CatalogAdminPage() {
  const { user, idToken, claims, flags, refreshRoles: refresh } = useAuth();
  const isAdmin = !!flags.isAdmin || !!claims?.admin || claims?.role === "admin";

  // Catálogo
  const [cats, setCats] = useState<any[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [selItemId, setSelItemId] = useState<string>("");

  // Formularios
  const [catName, setCatName] = useState("");
  const [catDesc, setCatDesc] = useState("");

  const [itemName, setItemName] = useState("");
  const [itemDesc, setItemDesc] = useState("");
  const [itemCat, setItemCat] = useState("");

  const [grpName, setGrpName] = useState("");
  const [grpMin, setGrpMin] = useState(0);
  const [grpMax, setGrpMax] = useState(0);

  const [optName, setOptName] = useState("");
  const [optDelta, setOptDelta] = useState(0);

  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        setErr(null);
        const c = await apiFetch("/api/categories?all=1&limit=500");
        const i = await apiFetch("/api/menu-items?limit=500");
        setCats(c.items || []);
        setItems(i.items || []);
      } catch (e: any) {
        setErr(e?.message || "No se pudo cargar el catálogo");
      }
    })();
  }, []);

  if (!user) {
    return (
      <main className="container py-4">
        <h1 className="h4">/admin/catalog</h1>
        <p className="text-danger">Debes iniciar sesión.</p>
      </main>
    );
  }
  if (!isAdmin) {
    return (
      <main className="container py-4">
        <h1 className="h4">/admin/catalog</h1>
        <p className="text-danger">Solo ADMIN puede gestionar el catálogo.</p>
        <button className="btn btn-outline-secondary btn-sm mt-2" onClick={refresh}>
          Refrescar roles
        </button>
      </main>
    );
  }

  // actions
  async function createCategory(e: any) {
    e.preventDefault(); setErr(null); setOk(null);
    try {
      const body = { name: catName, description: catDesc, isActive: true, sortOrder: 0 };
      const res = await apiFetchAuth("/api/categories", { method: "POST", body: JSON.stringify(body) }, idToken);
      setOk("Categoría creada");
      setCats((prev) => [res.item, ...prev]);
      setCatName(""); setCatDesc("");
    } catch (e: any) { setErr(e?.message || "Error al crear categoría"); }
  }

  async function createItem(e: any) {
    e.preventDefault(); setErr(null); setOk(null);
    try {
      const body = {
        name: itemName,
        description: itemDesc,
        categoryId: itemCat || null,
        isActive: true,
        isAvailable: true,
      };
      const res = await apiFetchAuth("/api/menu-items", { method: "POST", body: JSON.stringify(body) }, idToken);
      setOk("Plato (menuItem) creado");
      setItems((prev) => [res.item, ...prev]);
      setItemName(""); setItemDesc(""); setItemCat("");
    } catch (e: any) { setErr(e?.message || "Error al crear plato"); }
  }

  async function createGroup(e: any) {
    e.preventDefault(); setErr(null); setOk(null);
    try {
      if (!selItemId) throw new Error("Selecciona un plato");
      const body = {
        menuItemId: selItemId,
        name: grpName,
        minSelect: Number(grpMin) || 0,
        maxSelect: Number(grpMax) || 0,
        isActive: true,
        sortOrder: 0,
      };
      await apiFetchAuth("/api/option-groups", { method: "POST", body: JSON.stringify(body) }, idToken);
      setOk("Grupo de opciones creado");
      setGrpName(""); setGrpMin(0); setGrpMax(0);
    } catch (e: any) { setErr(e?.message || "Error al crear grupo"); }
  }

  async function createOption(e: any) {
    e.preventDefault(); setErr(null); setOk(null);
    try {
      const groupId = prompt("Ingresa el ID del grupo al que pertenece esta opción:");
      if (!groupId) return;
      const body = {
        groupId,
        name: optName,
        priceDelta: Number(optDelta) || 0,
        sortOrder: 0,
        isActive: true,
      };
      await apiFetchAuth("/api/option-items", { method: "POST", body: JSON.stringify(body) }, idToken);
      setOk("Opción creada");
      setOptName(""); setOptDelta(0);
    } catch (e: any) { setErr(e?.message || "Error al crear opción"); }
  }

  return (
    <main className="container py-4">
      <h1 className="h4 mb-3">Administrar Catálogo</h1>
      {err && <div className="alert alert-danger">{err}</div>}
      {ok && <div className="alert alert-success">{ok}</div>}

      <div className="row g-3">
        {/* CATEGORÍAS */}
        <div className="col-12 col-lg-4">
          <div className="card h-100">
            <div className="card-header fw-semibold">Nueva categoría</div>
            <form className="card-body vstack gap-2" onSubmit={createCategory}>
              <input className="form-control" placeholder="Nombre" value={catName} onChange={e=>setCatName(e.target.value)} required />
              <textarea className="form-control" placeholder="Descripción" value={catDesc} onChange={e=>setCatDesc(e.target.value)} />
              <button className="btn btn-primary">Crear categoría</button>
            </form>
          </div>
        </div>

        {/* PLATOS */}
        <div className="col-12 col-lg-4">
          <div className="card h-100">
            <div className="card-header fw-semibold">Nuevo plato (menuItem)</div>
            <form className="card-body vstack gap-2" onSubmit={createItem}>
              <input className="form-control" placeholder="Nombre del plato" value={itemName} onChange={e=>setItemName(e.target.value)} required />
              <textarea className="form-control" placeholder="Descripción" value={itemDesc} onChange={e=>setItemDesc(e.target.value)} />
              <select className="form-select" value={itemCat} onChange={e=>setItemCat(e.target.value)}>
                <option value="">(sin categoría)</option>
                {cats.map((c:any)=> <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <button className="btn btn-primary">Crear plato</button>
            </form>
          </div>
        </div>

        {/* GRUPOS + OPCIONES */}
        <div className="col-12 col-lg-4">
          <div className="card h-100">
            <div className="card-header fw-semibold">Grupos y opciones</div>
            <div className="card-body vstack gap-3">
              <div>
                <label className="form-label">Plato</label>
                <select className="form-select" value={selItemId} onChange={e=>setSelItemId(e.target.value)}>
                  <option value="">Selecciona plato</option>
                  {items.map((i:any)=> <option key={i.id} value={i.id}>{i.name || i.title}</option>)}
                </select>
              </div>

              <form className="vstack gap-2" onSubmit={createGroup}>
                <div className="fw-semibold">Nuevo Grupo</div>
                <input className="form-control" placeholder="Nombre del grupo (p. ej. Tamaño)" value={grpName} onChange={e=>setGrpName(e.target.value)} required />
                <div className="d-flex gap-2">
                  <input className="form-control" type="number" min={0} placeholder="minSelect" value={grpMin} onChange={e=>setGrpMin(parseInt(e.target.value || "0"))} />
                  <input className="form-control" type="number" min={0} placeholder="maxSelect (0 = sin tope)" value={grpMax} onChange={e=>setGrpMax(parseInt(e.target.value || "0"))} />
                </div>
                <button className="btn btn-secondary">Crear grupo</button>
              </form>

              <form className="vstack gap-2" onSubmit={createOption}>
                <div className="fw-semibold">Nueva Opción</div>
                <input className="form-control" placeholder="Nombre (p. ej. Grande)" value={optName} onChange={e=>setOptName(e.target.value)} required />
                <input className="form-control" type="number" step="0.01" placeholder="Delta de precio (Q)" value={optDelta} onChange={e=>setOptDelta(parseFloat((e.target.value||"0").replace(",",".")))} />
                <button className="btn btn-secondary">Crear opción</button>
              </form>

              <div className="small text-muted">
                * Para asociar la opción a un grupo, al crear la opción te pedirá el <b>ID del grupo</b>.
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Listados rápidos */}
      <div className="row g-3 mt-3">
        <div className="col-12 col-lg-6">
          <div className="card">
            <div className="card-header fw-semibold">Categorías</div>
            <div className="card-body">
              <ul className="list-group">
                {cats.map((c:any)=>(
                  <li key={c.id} className="list-group-item d-flex justify-content-between align-items-center">
                    <span>{c.name}</span>
                    <span className="badge bg-light text-dark">{c.id}</span>
                  </li>
                ))}
                {!cats.length && <li className="list-group-item text-muted">Sin categorías</li>}
              </ul>
            </div>
          </div>
        </div>

        <div className="col-12 col-lg-6">
          <div className="card">
            <div className="card-header fw-semibold">Platos</div>
            <div className="card-body">
              <ul className="list-group">
                {items.map((i:any)=>(
                  <li key={i.id} className="list-group-item d-flex justify-content-between align-items-center">
                    <div>
                      <div className="fw-semibold">{i.name || i.title}</div>
                      <div className="small text-muted">{i.description || ""}</div>
                    </div>
                    <span className="badge bg-light text-dark">{i.id}</span>
                  </li>
                ))}
                {!items.length && <li className="list-group-item text-muted">Sin platos</li>}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
