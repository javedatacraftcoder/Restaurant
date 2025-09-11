// src/app/admin/promotions/page.tsx
'use client';

import { OnlyAdmin } from "@/components/Only";
import React, { useEffect, useMemo, useState } from "react";

/* =========================================================================
   Firebase (cliente): Auth + Firestore
   ========================================================================= */
function getFirebaseClientConfig() {
  return {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY!,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN!,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID!,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID!,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  };
}
async function ensureFirebaseApp() {
  const app = await import("firebase/app");
  if (!app.getApps().length) {
    const cfg = getFirebaseClientConfig();
    if (cfg.apiKey && cfg.authDomain && cfg.projectId && cfg.appId) {
      app.initializeApp(cfg);
    } else {
      console.warn("[Firebase] Faltan variables NEXT_PUBLIC_* para inicializar el cliente.");
    }
  }
}
async function getAuthMod() {
  await ensureFirebaseApp();
  return await import("firebase/auth");
}
async function getFirestoreMod() {
  await ensureFirebaseApp();
  return await import("firebase/firestore");
}

function useAuthClaims() {
  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState<any | null>(null);
  const [claims, setClaims] = useState<any | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { onAuthStateChanged, getAuth, getIdTokenResult } = await getAuthMod();
      const auth = getAuth();
      const unsub = onAuthStateChanged(auth, async (u) => {
        if (!alive) return;
        setUser(u ?? null);
        if (u) {
          try {
            const r = await getIdTokenResult(u);
            setClaims(r.claims || null);
          } catch {
            setClaims(null);
          }
        } else {
          setClaims(null);
        }
        setAuthReady(true);
      });
      return () => unsub();
    })();
    return () => { alive = false; };
  }, []);

  return { authReady, user, isAdmin: !!claims?.admin } as const;
}

/* =========================================================================
   Tipos según tus colecciones actuales
   ========================================================================= */
type Category = {
  id: string;
  name: string;
  slug?: string;
  isActive?: boolean;
  sortOrder?: number;
  imageUrl?: string | null;
};
type Subcategory = {
  id: string;
  name: string;
  categoryId: string;
  isActive?: boolean;
  sortOrder?: number;
  imageUrl?: string | null;
};
type MenuItem = {
  id: string;
  name: string;
  price: number;           // GTQ
  categoryId: string;
  subcategoryId: string;
  active?: boolean;
  imageUrl?: string | null;
  description?: string | null;
};

type Promotion = {
  id: string;
  name: string;
  code: string;            // UPPERCASE y único lógico
  type: "percent" | "fixed";
  value: number;           // percent: 1-100; fixed: GTQ
  active: boolean;

  // Vigencia
  startAt?: any | null;    // Firestore Timestamp/Date
  endAt?: any | null;

  // Alcance
  scope?: {
    categories?: string[];
    subcategories?: string[];
    menuItems?: string[];
  };

  // Reglas
  constraints?: {
    minTargetSubtotal?: number;       // GTQ sobre el subtotal de ítems elegibles
    allowedOrderTypes?: Array<"dine_in" | "delivery" | "takeaway">;
    globalLimit?: number;             // usos totales
    perUserLimit?: number;            // usos por usuario
    stackable?: boolean;              // combinar con otras promos
    autoApply?: boolean;              // aplicar sin código si califica
  };

  timesRedeemed?: number;   // contador
  createdAt?: any;
  updatedAt?: any;
};

/* =========================================================================
   Utils
   ========================================================================= */
function fmtQ(n?: number) {
  if (typeof n !== "number") return "—";
  try {
    return new Intl.NumberFormat("es-GT", { style: "currency", currency: "GTQ" }).format(n);
  } catch {
    return `Q ${n.toFixed(2)}`;
  }
}
function toNumber(v: any): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}
function normalizeCode(s: string) {
  return (s || "").trim().toUpperCase().replace(/\s+/g, "");
}

/** Elimina TODAS las llaves con undefined de forma profunda (sin romper Date/Timestamp). */
function removeUndefinedDeep<T>(obj: T): T {
  if (obj === undefined || obj === null) return obj;
  if (Array.isArray(obj)) {
    // en arrays, filtramos elementos undefined
    return obj.map((v) => removeUndefinedDeep(v)).filter((v) => v !== undefined) as any;
  }
  if (typeof obj === "object") {
    // no transformar Date/Firestore Timestamp
    const isDate = obj instanceof Date || (typeof (obj as any).toDate === "function");
    if (isDate) return obj;
    const out: any = {};
    Object.entries(obj as any).forEach(([k, v]) => {
      const cleaned = removeUndefinedDeep(v as any);
      if (cleaned !== undefined) out[k] = cleaned;
    });
    return out;
  }
  return obj;
}

/* =========================================================================
   Firestore helpers
   ========================================================================= */
async function createDoc(collName: string, data: any): Promise<string> {
  const { getFirestore, collection, addDoc, serverTimestamp } = await getFirestoreMod();
  const db = getFirestore();
  const ref = await addDoc(collection(db, collName), {
    ...data,
    createdAt: serverTimestamp?.(),
    updatedAt: serverTimestamp?.(),
  });
  return ref.id;
}
async function updateDocById(collName: string, id: string, data: any) {
  const { getFirestore, doc, updateDoc, serverTimestamp } = await getFirestoreMod();
  const db = getFirestore();
  await updateDoc(doc(db, collName, id), { ...data, updatedAt: serverTimestamp?.() });
}
async function deleteDocById(collName: string, id: string) {
  const { getFirestore, doc, deleteDoc } = await getFirestoreMod();
  const db = getFirestore();
  await deleteDoc(doc(db, collName, id));
}

/* =========================================================================
   Página /admin/promotions
   ========================================================================= */
function AdminPromotionsPage_Inner() {
  const { authReady, user, isAdmin } = useAuthClaims();

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // Catálogo para “scope”
  const [categories, setCategories] = useState<Category[]>([]);
  const [subcategories, setSubcategories] = useState<Subcategory[]>([]);
  const [items, setItems] = useState<MenuItem[]>([]);

  // Promociones
  const [promos, setPromos] = useState<Promotion[]>([]);
  const [search, setSearch] = useState("");

  // Formulario
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [type, setType] = useState<"percent" | "fixed">("percent");
  const [value, setValue] = useState<string>(""); // string para campo controlado
  const [active, setActive] = useState(true);

  const [startAt, setStartAt] = useState<string>(""); // datetime-local string
  const [endAt, setEndAt] = useState<string>("");

  // Alcance
  const [scopeCats, setScopeCats] = useState<string[]>([]);
  const [scopeSubs, setScopeSubs] = useState<string[]>([]);
  const [scopeItems, setScopeItems] = useState<string[]>([]);

  // Reglas
  const [minTargetSubtotal, setMinTargetSubtotal] = useState<string>("");
  const [allowedOrderTypes, setAllowedOrderTypes] = useState<Array<"dine_in" | "delivery" | "takeaway">>([]);
  const [globalLimit, setGlobalLimit] = useState<string>("");
  const [perUserLimit, setPerUserLimit] = useState<string>("");
  const [stackable, setStackable] = useState<boolean>(false);
  const [autoApply, setAutoApply] = useState<boolean>(false);

  // Filtros de ayuda para listar ítems
  const [filterCat, setFilterCat] = useState<string>("");
  const [filterSub, setFilterSub] = useState<string>("");

  const itemsFiltered = useMemo(() => {
    return items.filter((mi) => {
      if (filterCat && mi.categoryId !== filterCat) return false;
      if (filterSub && mi.subcategoryId !== filterSub) return false;
      return true;
    });
  }, [items, filterCat, filterSub]);

  // Suscripciones en tiempo real
  useEffect(() => {
    let unsubCats: any, unsubSubs: any, unsubItems: any, unsubPromos: any;
    (async () => {
      if (!(user && isAdmin)) { setLoading(false); return; }
      try {
        setLoading(true);
        setErr(null);

        const { getFirestore, collection, onSnapshot, query, orderBy } = await getFirestoreMod();
        const db = getFirestore();

        // categorías (orden por sortOrder si existe)
        try {
          unsubCats = onSnapshot(query(collection(db, "categories"), orderBy("sortOrder", "asc")), (snap) => {
            const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
            setCategories(rows as Category[]);
          });
        } catch {
          unsubCats = onSnapshot(collection(db, "categories"), (snap) => {
            const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
            rows.sort((a: any, b: any) => String(a?.name||"").localeCompare(String(b?.name||"")));
            setCategories(rows as Category[]);
          });
        }

        // subcategorías
        try {
          unsubSubs = onSnapshot(query(collection(db, "subcategories"), orderBy("sortOrder", "asc")), (snap) => {
            const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
            setSubcategories(rows as Subcategory[]);
          });
        } catch {
          unsubSubs = onSnapshot(collection(db, "subcategories"), (snap) => {
            const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
            rows.sort((a: any, b: any) => String(a?.name||"").localeCompare(String(b?.name||"")));
            setSubcategories(rows as Subcategory[]);
          });
        }

        // items
        unsubItems = onSnapshot(collection(db, "menuItems"), (snap) => {
          const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
          rows.sort((a: any, b: any) => String(a?.name||"").localeCompare(String(b?.name||"")));
          setItems(rows as MenuItem[]);
        });

        // promotions
        unsubPromos = onSnapshot(collection(db, "promotions"), (snap) => {
          const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
          // opcional: ordenar por updatedAt desc o name
          rows.sort((a: any, b: any) => String(a?.name||"").localeCompare(String(b?.name||"")));
          setPromos(rows as Promotion[]);
        });

      } catch (e: any) {
        setErr(e?.message || "Error cargando datos");
      } finally {
        setLoading(false);
      }
    })();

    return () => {
      try { unsubCats && unsubCats(); } catch {}
      try { unsubSubs && unsubSubs(); } catch {}
      try { unsubItems && unsubItems(); } catch {}
      try { unsubPromos && unsubPromos(); } catch {}
    };
  }, [user, isAdmin]);

  /* =========================================================================
     Guardar / Editar / Borrar
     ========================================================================= */
  async function isCodeTaken(codeUpper: string, ignoreId?: string) {
    const { getFirestore, collection, query, where, getDocs, limit } = await getFirestoreMod();
    const db = getFirestore();
    const q = query(collection(db, "promotions"), where("code", "==", codeUpper), limit(1));
    const snap = await getDocs(q);
    if (snap.empty) return false;
    const doc0 = snap.docs[0];
    return doc0.id !== ignoreId;
  }

  async function onSavePromotion() {
    try {
      const nameV = name.trim();
      if (!nameV) { alert("Nombre de promoción requerido"); return; }

      const codeV = normalizeCode(code);
      if (!codeV) { alert("Código requerido"); return; }

      const valN = toNumber(value);
      if (!valN || valN <= 0) { alert(type === "percent" ? "Porcentaje inválido" : "Monto inválido"); return; }
      if (type === "percent" && (valN <= 0 || valN > 100)) { alert("El porcentaje debe ser 1–100"); return; }

      // chequear unicidad de código
      if (await isCodeTaken(codeV, editingId || undefined)) {
        alert("Ese código ya existe. Usa otro.");
        return;
      }

      // Alcance (si queda vacío => aplica a todo el catálogo)
      const scopeRaw: Promotion["scope"] = {
        categories: scopeCats.length ? scopeCats : undefined,
        subcategories: scopeSubs.length ? scopeSubs : undefined,
        menuItems: scopeItems.length ? scopeItems : undefined,
      };

      // Fechas
      const startDate = startAt ? new Date(startAt) : undefined;
      const endDate = endAt ? new Date(endAt) : undefined;

      // Reglas
      const constraintsRaw: Promotion["constraints"] = {
        minTargetSubtotal: minTargetSubtotal ? Number(minTargetSubtotal) : undefined,
        allowedOrderTypes: allowedOrderTypes.length ? allowedOrderTypes : undefined,
        globalLimit: globalLimit ? Number(globalLimit) : undefined,
        perUserLimit: perUserLimit ? Number(perUserLimit) : undefined,
        stackable: stackable || undefined,
        autoApply: autoApply || undefined,
      };

      // 🔧 Limpieza de undefined profundo
      const scope = removeUndefinedDeep(scopeRaw) || {};
      const constraints = removeUndefinedDeep(constraintsRaw) || {};

      const payloadRaw: Partial<Promotion> = {
        name: nameV,
        code: codeV,
        type,
        value: valN!,
        active: !!active,
        startAt: startDate || null,
        endAt: endDate || null,
        scope,
        constraints,
      };

      // Si scope/constraints quedan vacíos, los omitimos
      const payload: any = removeUndefinedDeep(payloadRaw);
      if (payload.scope && Object.keys(payload.scope).length === 0) delete payload.scope;
      if (payload.constraints && Object.keys(payload.constraints).length === 0) delete payload.constraints;

      if (!editingId) {
        const newId = await createDoc("promotions", payload);
        await updateDocById("promotions", newId, { id: newId, timesRedeemed: 0 });
      } else {
        await updateDocById("promotions", editingId, payload);
      }

      resetForm();
      alert("Promoción guardada.");
    } catch (e: any) {
      alert(e?.message || "No se pudo guardar la promoción");
    }
  }

  async function onDeletePromotion(id: string) {
    if (!confirm("¿Eliminar esta promoción?")) return;
    try {
      await deleteDocById("promotions", id);
    } catch (e: any) {
      alert(e?.message || "No se pudo eliminar la promoción");
    }
  }

  function resetForm() {
    setEditingId(null);
    setName("");
    setCode("");
    setType("percent");
    setValue("");
    setActive(true);
    setStartAt("");
    setEndAt("");
    setScopeCats([]);
    setScopeSubs([]);
    setScopeItems([]);
    setMinTargetSubtotal("");
    setAllowedOrderTypes([]);
    setGlobalLimit("");
    setPerUserLimit("");
    setStackable(false);
    setAutoApply(false);
  }

  function onEditPromotion(p: Promotion) {
    setEditingId(p.id);
    setName(p.name || "");
    setCode(p.code || "");
    setType((p.type as any) || "percent");
    setValue(typeof p.value === "number" ? String(p.value) : "");
    setActive(p.active !== false);

    // Timestamps a datetime-local
    const toLocalStr = (d: any) => {
      if (!d) return "";
      const dt = (typeof d?.toDate === "function") ? d.toDate() : (d instanceof Date ? d : new Date(d));
      const pad = (n: number) => String(n).padStart(2, "0");
      const yyyy = dt.getFullYear();
      const mm = pad(dt.getMonth() + 1);
      const dd = pad(dt.getDate());
      const hh = pad(dt.getHours());
      const mi = pad(dt.getMinutes());
      return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
    };
    setStartAt(p.startAt ? toLocalStr(p.startAt) : "");
    setEndAt(p.endAt ? toLocalStr(p.endAt) : "");

    setScopeCats(p.scope?.categories || []);
    setScopeSubs(p.scope?.subcategories || []);
    setScopeItems(p.scope?.menuItems || []);

    setMinTargetSubtotal(p.constraints?.minTargetSubtotal != null ? String(p.constraints!.minTargetSubtotal) : "");
    setAllowedOrderTypes(p.constraints?.allowedOrderTypes || []);
    setGlobalLimit(p.constraints?.globalLimit != null ? String(p.constraints!.globalLimit) : "");
    setPerUserLimit(p.constraints?.perUserLimit != null ? String(p.constraints!.perUserLimit) : "");
    setStackable(!!p.constraints?.stackable);
    setAutoApply(!!p.constraints?.autoApply);
  }

  /* =========================================================================
     UI helpers
     ========================================================================= */
  function scopeSummary(p: Promotion) {
    const cats = p.scope?.categories?.length || 0;
    const subs = p.scope?.subcategories?.length || 0;
    const mis  = p.scope?.menuItems?.length || 0;
    if (!cats && !subs && !mis) return "Todos los ítems";
    const parts: string[] = [];
    if (cats) parts.push(`${cats} categoría(s)`);
    if (subs) parts.push(`${subs} subcat(s)`);
    if (mis)  parts.push(`${mis} plato(s)`);
    return parts.join(" · ");
  }
  function discountSummary(p: Promotion) {
    return p.type === "percent" ? `${p.value}%` : `${fmtQ(p.value)} fijo`;
  }
  function ruleSummary(p: Promotion) {
    const arr: string[] = [];
    if (p.constraints?.minTargetSubtotal) arr.push(`mín ${fmtQ(p.constraints.minTargetSubtotal)}`);
    if (p.constraints?.allowedOrderTypes?.length) arr.push(p.constraints.allowedOrderTypes.join("/"));
    if (p.constraints?.globalLimit != null) arr.push(`límite global: ${p.constraints.globalLimit}`);
    if (p.constraints?.perUserLimit != null) arr.push(`límite usuario: ${p.constraints.perUserLimit}`);
    if (p.constraints?.stackable) arr.push("acumulable");
    if (p.constraints?.autoApply) arr.push("auto");
    return arr.join(" · ") || "—";
  }

  const promosFiltered = useMemo(() => {
    const q = (search || "").toLowerCase().trim();
    if (!q) return promos;
    return promos.filter(p =>
      (p.name || "").toLowerCase().includes(q) ||
      (p.code || "").toLowerCase().includes(q)
    );
  }, [promos, search]);

  /* =========================================================================
     Render
     ========================================================================= */
  if (!authReady) return <div className="container py-3">Inicializando sesión…</div>;
  if (!user) return <div className="container py-5 text-danger">Debes iniciar sesión.</div>;
  if (!isAdmin) return <div className="container py-5 text-danger">No autorizado (solo administradores).</div>;

  return (
    <div className="container py-3">
      <div className="d-flex align-items-center justify-content-between mb-3">
        <h1 className="h4 m-0">Promociones — Códigos de descuento</h1>
        <span className="text-muted small">Actualización en tiempo real</span>
      </div>
      {err && <div className="alert alert-danger">{err}</div>}

      <div className="row g-3">
        {/* ===================== Columna izquierda: Crear/Editar ===================== */}
        <div className="col-12 col-lg-5">
          <div className="card">
            <div className="card-header d-flex align-items-center justify-content-between">
              <span>{editingId ? "Editar promoción" : "Crear promoción"}</span>
              {editingId && (
                <button className="btn btn-sm btn-outline-secondary" onClick={resetForm}>Nueva</button>
              )}
            </div>
            <div className="card-body">
              {/* Básicos */}
              <div className="mb-2">
                <label className="form-label">Nombre (visible para cliente)</label>
                <input className="form-control" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="row g-2">
                <div className="col-8">
                  <label className="form-label">Código</label>
                  <input
                    className="form-control"
                    value={code}
                    onChange={(e) => setCode(e.target.value.toUpperCase())}
                    placeholder="p.ej. POSTRES10"
                  />
                </div>
                <div className="col-4 d-flex align-items-end">
                  <div className="form-check">
                    <input className="form-check-input" type="checkbox" id="act" checked={active} onChange={(e) => setActive(e.target.checked)} />
                    <label className="form-check-label" htmlFor="act">Activo</label>
                  </div>
                </div>
              </div>

              <div className="row g-2 mt-1">
                <div className="col-6">
                  <label className="form-label">Tipo de descuento</label>
                  <select className="form-select" value={type} onChange={(e) => setType(e.target.value as any)}>
                    <option value="percent">% porcentaje</option>
                    <option value="fixed">Q monto fijo</option>
                  </select>
                </div>
                <div className="col-6">
                  <label className="form-label">{type === "percent" ? "Porcentaje (1–100)" : "Monto (GTQ)"}</label>
                  <input
                    type="number"
                    step="0.01"
                    className="form-control"
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                  />
                </div>
              </div>

              <div className="row g-2 mt-2">
                <div className="col-6">
                  <label className="form-label">Inicio (opcional)</label>
                  <input type="datetime-local" className="form-control" value={startAt} onChange={(e) => setStartAt(e.target.value)} />
                </div>
                <div className="col-6">
                  <label className="form-label">Fin (opcional)</label>
                  <input type="datetime-local" className="form-control" value={endAt} onChange={(e) => setEndAt(e.target.value)} />
                </div>
              </div>

              <hr className="my-3" />
              {/* Alcance */}
              <div className="d-flex align-items-center justify-content-between mb-2">
                <strong>Alcance (¿a qué aplica?)</strong>
                <button
                  type="button"
                  className="btn btn-sm btn-outline-secondary"
                  onClick={() => { setScopeCats([]); setScopeSubs([]); setScopeItems([]); }}
                >
                  Limpiar selección
                </button>
              </div>

              <div className="row g-2">
                <div className="col-12 col-md-4">
                  <div className="border rounded p-2" style={{ maxHeight: 180, overflow: "auto" }}>
                    <div className="fw-semibold small mb-1">Categorías</div>
                    {categories.length === 0 && <div className="text-muted small">No hay categorías.</div>}
                    {categories.map((c) => {
                      const checked = scopeCats.includes(c.id);
                      return (
                        <label key={c.id} className="form-check small d-flex align-items-center gap-1">
                          <input
                            className="form-check-input"
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              const v = e.currentTarget.checked;
                              setScopeCats((prev) => v ? [...new Set([...prev, c.id])] : prev.filter(x => x !== c.id));
                            }}
                          />
                          <span className="text-truncate">{c.name}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>

                <div className="col-12 col-md-4">
                  <div className="border rounded p-2" style={{ maxHeight: 180, overflow: "auto" }}>
                    <div className="fw-semibold small mb-1">Subcategorías</div>
                    {subcategories.length === 0 && <div className="text-muted small">No hay subcategorías.</div>}
                    {subcategories.map((s) => {
                      const checked = scopeSubs.includes(s.id);
                      const catName = categories.find(c => c.id === s.categoryId)?.name || "—";
                      return (
                        <label key={s.id} className="form-check small d-flex align-items-center gap-1">
                          <input
                            className="form-check-input"
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              const v = e.currentTarget.checked;
                              setScopeSubs((prev) => v ? [...new Set([...prev, s.id])] : prev.filter(x => x !== s.id));
                            }}
                          />
                          <span className="text-truncate">{s.name} <span className="text-muted">({catName})</span></span>
                        </label>
                      );
                    })}
                  </div>
                </div>

                <div className="col-12 col-md-4">
                  <div className="border rounded p-2">
                    <div className="d-flex align-items-center justify-content-between">
                      <div className="fw-semibold small">Platos</div>
                      <div className="d-flex gap-2">
                        <select className="form-select form-select-sm" style={{ width: 160 }} value={filterCat} onChange={(e) => { setFilterCat(e.target.value); setFilterSub(""); }}>
                          <option value="">(Todas las categorías)</option>
                          {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                        <select className="form-select form-select-sm" style={{ width: 160 }} value={filterSub} onChange={(e) => setFilterSub(e.target.value)}>
                          <option value="">(Todas las subcategorías)</option>
                          {subcategories.filter(s => !filterCat || s.categoryId === filterCat).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </select>
                      </div>
                    </div>

                    <div style={{ maxHeight: 180, overflow: "auto" }} className="mt-2">
                      {itemsFiltered.length === 0 && <div className="text-muted small">Sin platos.</div>}
                      {itemsFiltered.map((mi) => {
                        const checked = scopeItems.includes(mi.id);
                        const cName = categories.find(c => c.id === mi.categoryId)?.name || "—";
                        const sName = subcategories.find(s => s.id === mi.subcategoryId)?.name || "—";
                        return (
                          <label key={mi.id} className="form-check small d-flex align-items-center gap-1">
                            <input
                              className="form-check-input"
                              type="checkbox"
                              checked={checked}
                              onChange={(e) => {
                                const v = e.currentTarget.checked;
                                setScopeItems((prev) => v ? [...new Set([...prev, mi.id])] : prev.filter(x => x !== mi.id));
                              }}
                            />
                            <span className="text-truncate">{mi.name} <span className="text-muted">({cName} · {sName})</span></span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>

              <hr className="my-3" />
              {/* Reglas */}
              <strong>Reglas</strong>
              <div className="row g-2 mt-1">
                <div className="col-6">
                  <label className="form-label">Mín. subtotal elegible (GTQ)</label>
                  <input type="number" step="0.01" className="form-control" value={minTargetSubtotal} onChange={(e) => setMinTargetSubtotal(e.target.value)} />
                </div>
                <div className="col-6">
                  <label className="form-label">Tipos de orden permitidos</label>
                  <div className="d-flex flex-wrap gap-3 border rounded p-2">
                    {(["dine_in","delivery","takeaway"] as const).map((t) => (
                      <label key={t} className="form-check">
                        <input
                          className="form-check-input"
                          type="checkbox"
                          checked={allowedOrderTypes.includes(t)}
                          onChange={(e) => {
                            const v = e.currentTarget.checked;
                            setAllowedOrderTypes((prev) => v ? [...new Set([...prev, t])] : prev.filter(x => x !== t));
                          }}
                        />
                        <span className="form-check-label text-capitalize ms-1">{t.replace("_", " ")}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="col-6">
                  <label className="form-label">Límite global de usos</label>
                  <input type="number" className="form-control" value={globalLimit} onChange={(e) => setGlobalLimit(e.target.value)} />
                </div>
                <div className="col-6">
                  <label className="form-label">Límite por usuario</label>
                  <input type="number" className="form-control" value={perUserLimit} onChange={(e) => setPerUserLimit(e.target.value)} />
                </div>

                <div className="col-6 d-flex align-items-end">
                  <div className="form-check">
                    <input className="form-check-input" type="checkbox" id="stack" checked={stackable} onChange={(e) => setStackable(e.target.checked)} />
                    <label className="form-check-label" htmlFor="stack">Acumulable (stackable)</label>
                  </div>
                </div>
                <div className="col-6 d-flex align-items-end">
                  <div className="form-check">
                    <input className="form-check-input" type="checkbox" id="auto" checked={autoApply} onChange={(e) => setAutoApply(e.target.checked)} />
                    <label className="form-check-label" htmlFor="auto">Aplicar automático (autoApply)</label>
                  </div>
                </div>
              </div>

              <div className="text-end mt-3">
                <button className="btn btn-primary" onClick={onSavePromotion}>
                  {editingId ? "Guardar cambios" : "Crear promoción"}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* ===================== Columna derecha: Listado ===================== */}
        <div className="col-12 col-lg-7">
          <div className="card">
            <div className="card-header d-flex align-items-center justify-content-between">
              <span>Promociones existentes</span>
              <input
                className="form-control form-control-sm"
                style={{ maxWidth: 240 }}
                placeholder="Buscar por nombre o código…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="card-body">
              {promosFiltered.length === 0 && <div className="text-muted small">Sin promociones.</div>}
              <div className="row g-3">
                {promosFiltered.map((p) => {
                  // Fechas legibles
                  const toStr = (d: any) => {
                    if (!d) return "—";
                    const dt = (typeof d?.toDate === "function") ? d.toDate() : (d instanceof Date ? d : new Date(d));
                    return dt.toLocaleString();
                  };
                  return (
                    <div key={p.id} className="col-12">
                      <div className="card h-100">
                        <div className="card-body">
                          <div className="d-flex justify-content-between align-items-start">
                            <div>
                              <div className="fw-semibold">{p.name}</div>
                              <div className="text-muted small">
                                Código: <strong>{p.code}</strong> · {discountSummary(p)} · {p.active ? <span className="badge text-bg-success">activo</span> : <span className="badge text-bg-secondary">inactivo</span>}
                              </div>
                              <div className="text-muted small mt-1">
                                Alcance: {scopeSummary(p)}
                              </div>
                              <div className="text-muted small">
                                Reglas: {ruleSummary(p)}
                              </div>
                              <div className="text-muted small">
                                Vigencia: {toStr(p.startAt)} → {toStr(p.endAt)}
                              </div>
                              <div className="text-muted small">
                                Usos: {typeof p.timesRedeemed === "number" ? p.timesRedeemed : 0}
                              </div>
                            </div>
                            <div className="d-flex flex-column gap-2 align-items-stretch" style={{ minWidth: 160 }}>
                              <button className="btn btn-outline-secondary btn-sm w-100" onClick={() => onEditPromotion(p)}>Editar</button>
                              <button className="btn btn-outline-danger btn-sm w-100" onClick={() => onDeletePromotion(p.id)}>Eliminar</button>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="alert alert-light border mt-3 small">
            <strong>Nota:</strong> esta página solo administra metadatos de promociones. En el <em>checkout</em> agregaremos un campo de código y un endpoint que calcule el descuento
            únicamente sobre ítems elegibles (por categoría, subcategoría o plato). No he tocado nada del checkout todavía.
          </div>
        </div>
      </div>
    </div>
  );
}

export default function AdminPromotionsPage() {
  return (
    <OnlyAdmin>
      <AdminPromotionsPage_Inner />
    </OnlyAdmin>
  );
}
