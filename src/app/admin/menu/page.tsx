// src/app/admin/menu/page.tsx
'use client';

import { OnlyAdmin } from "@/components/Only";

import React, { useEffect, useMemo, useState } from 'react';

/* =========================================================================
   Firebase (cliente): Auth + Firestore + Storage
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
  const app = await import('firebase/app');
  if (!app.getApps().length) {
    const cfg = getFirebaseClientConfig();
    if (cfg.apiKey && cfg.authDomain && cfg.projectId && cfg.appId) {
      app.initializeApp(cfg);
    } else {
      console.warn('[Firebase] Faltan variables NEXT_PUBLIC_* para inicializar el cliente.');
    }
  }
}
async function getAuthMod() {
  await ensureFirebaseApp();
  return await import('firebase/auth');
}
async function getFirestoreMod() {
  await ensureFirebaseApp();
  return await import('firebase/firestore');
}
async function getStorageMod() {
  await ensureFirebaseApp();
  return await import('firebase/storage');
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

  return {
    authReady,
    user,
    isAdmin: !!claims?.admin,
  } as const;
}

/* =========================================================================
   Tipos (Firestore)
   ========================================================================= */
type Category = {
  id: string;
  name: string;
  slug?: string;
  description?: string;
  isActive?: boolean;
  sortOrder?: number;
  imageUrl?: string | null;
  imagePath?: string | null;
};

type Subcategory = {
  id: string;
  name: string;
  categoryId: string;
  isActive?: boolean;
  sortOrder?: number;
  imageUrl?: string | null;
  imagePath?: string | null;
};

type Addon = {
  name: string;
  price: number; // GTQ
};

type MenuItem = {
  id: string;
  name: string;
  price: number; // GTQ
  categoryId: string;
  subcategoryId: string;
  imageUrl?: string | null;
  imagePath?: string | null;
  addons?: Addon[];
  optionGroupIds?: string[]; // relación a option-groups
  active?: boolean;
  /** Descripción visible en el Menú público */
  description?: string | null;
};

type OptionGroup = {
  id: string;
  name: string;
  type?: 'single' | 'multi';
  required?: boolean;
  min?: number;
  max?: number;
  active?: boolean;
  sortOrder?: number;
};

type OptionItem = {
  id?: string;
  groupId: string;
  name: string;
  priceDelta?: number;
  isDefault?: boolean;
  active?: boolean;
  sortOrder?: number;
};

/* =========================================================================
   Helpers UI / utils
   ========================================================================= */
function fmtQ(n?: number) {
  if (typeof n !== 'number') return '—';
  try {
    return new Intl.NumberFormat('es-GT', { style: 'currency', currency: 'GTQ' }).format(n);
  } catch {
    return `Q ${n.toFixed(2)}`;
  }
}
function toNumber(v: any): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}
function slugify(s: string) {
  return s
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

/* =========================================================================
   Firestore helpers (CRUD básicos)
   ========================================================================= */
async function createDoc(collName: string, data: any): Promise<string> {
  const { getFirestore, collection, addDoc, serverTimestamp } = await getFirestoreMod();
  const db = getFirestore();
  const docRef = await addDoc(collection(db, collName), {
    ...data,
    createdAt: serverTimestamp?.(),
    updatedAt: serverTimestamp?.(),
  });
  return docRef.id;
}

async function updateDocById(collName: string, id: string, data: any) {
  const { getFirestore, doc, updateDoc, serverTimestamp } = await getFirestoreMod();
  const db = getFirestore();
  const ref = doc(db, collName, id);
  await updateDoc(ref, { ...data, updatedAt: serverTimestamp?.() });
}

async function deleteDocById(collName: string, id: string) {
  const { getFirestore, doc, deleteDoc } = await getFirestoreMod();
  const db = getFirestore();
  const ref = doc(db, collName, id);
  await deleteDoc(ref);
}

/* =========================================================================
   Storage (upload / delete)
   ========================================================================= */
async function uploadMenuImage(file: File, keyPath: string): Promise<{ url: string; path: string }> {
  const { getStorage, ref, uploadBytes, getDownloadURL } = await getStorageMod();
  const storage = getStorage();
  const r = ref(storage, keyPath);
  await uploadBytes(r, file);
  const url = await getDownloadURL(r);
  return { url, path: keyPath };
}
async function deleteImageByPath(path: string) {
  try {
    const { getStorage, ref, deleteObject } = await getStorageMod();
    const storage = getStorage();
    const r = ref(storage, path);
    await deleteObject(r);
  } catch (e) {
    console.warn('No se pudo eliminar imagen anterior:', e);
  }
}

/* =========================================================================
   Página Unificada: /admin/menu (con suscripciones en tiempo real)
   ========================================================================= */
function AdminMenuPage_Inner() {
  const { authReady, user, isAdmin } = useAuthClaims();

  const [categories, setCategories] = useState<Category[]>([]);
  const [subcategories, setSubcategories] = useState<Subcategory[]>([]);
  const [groups, setGroups] = useState<OptionGroup[]>([]);
  const [items, setItems] = useState<MenuItem[]>([]);

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // Filtros para listado de platos
  const [filterCat, setFilterCat] = useState<string>('');
  const [filterSub, setFilterSub] = useState<string>('');

  // Formularios controlados
  const [catName, setCatName] = useState('');
  const [editingCatId, setEditingCatId] = useState<string | null>(null);

  // ---- estados de subcategorías ----
  const [subName, setSubName] = useState('');
  const [subCatId, setSubCatId] = useState('');
  const [editingSubId, setEditingSubId] = useState<string | null>(null);

  // ---- estados del formulario de plato ----
  const [itemEditingId, setItemEditingId] = useState<string | null>(null);
  const [itemName, setItemName] = useState('');
  const [itemPrice, setItemPrice] = useState<string>('');
  const [itemCatId, setItemCatId] = useState('');
  const [itemSubId, setItemSubId] = useState('');
  const [itemActive, setItemActive] = useState(true);
  const [itemOptionGroupIds, setItemOptionGroupIds] = useState<string[]>([]);
  const [addons, setAddons] = useState<Addon[]>([]);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageMeta, setImageMeta] = useState<{ url?: string | null; path?: string | null }>({});
  const [itemDescription, setItemDescription] = useState<string>('');

  // ---- NUEVO: estado UI para crear grupos de opciones inline ----
  const [showOGCreator, setShowOGCreator] = useState(false);

  // ---- NUEVO: estado del formulario de grupo ----
  const [ogName, setOgName] = useState('');
  const [ogType, setOgType] = useState<'single' | 'multi'>('single');
  const [ogRequired, setOgRequired] = useState(false);
  const [ogMin, setOgMin] = useState<number | ''>('');
  const [ogMax, setOgMax] = useState<number | ''>('');
  const [ogActive, setOgActive] = useState(true);
  const [ogSortOrder, setOgSortOrder] = useState<number | ''>('');

  // ---- NUEVO: estado del listado de option-items a crear con el grupo ----
  const [oiRows, setOiRows] = useState<Array<{
    name: string;
    priceDelta: string;
    isDefault: boolean;
    active: boolean;
    sortOrder: string;
  }>>([]);

  const resetItemForm = () => {
    setItemEditingId(null);
    setItemName('');
    setItemPrice('');
    setItemCatId('');
    setItemSubId('');
    setItemActive(true);
    setItemOptionGroupIds([]);
    setAddons([]);
    setImageFile(null);
    setImagePreview(null);
    setImageMeta({});
    setItemDescription('');
  };

  const resetOGForm = () => {
    setOgName('');
    setOgType('single');
    setOgRequired(false);
    setOgMin('');
    setOgMax('');
    setOgActive(true);
    setOgSortOrder('');
    setOiRows([]);
  };

  /* =============================
     Suscripciones en tiempo real
     ============================= */
  useEffect(() => {
    let unsubCats: any, unsubSubs: any, unsubGrps: any, unsubItems: any;

    (async () => {
      if (!(user && isAdmin)) {
        setLoading(false);
        return;
      }
      try {
        setErr(null);
        setLoading(true);

        const {
          getFirestore, collection, onSnapshot, query, orderBy,
        } = await getFirestoreMod();
        const db = getFirestore();

        // Categorías
        try {
          unsubCats = onSnapshot(
            query(collection(db, 'categories'), orderBy('sortOrder', 'asc')),
            (snap) => {
              const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() } as any));
              setCategories(rows);
            }
          );
        } catch {
          unsubCats = onSnapshot(
            collection(db, 'categories'),
            (snap) => {
              const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() } as any));
              rows.sort((a: any, b: any) => String(a?.name||'').localeCompare(String(b?.name||'')));
              setCategories(rows);
            }
          );
        }

        // Subcategorías
        try {
          unsubSubs = onSnapshot(
            query(collection(db, 'subcategories'), orderBy('sortOrder', 'asc')),
            (snap) => {
              const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() } as any));
              setSubcategories(rows);
            }
          );
        } catch {
          unsubSubs = onSnapshot(
            collection(db, 'subcategories'),
            (snap) => {
              const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() } as any));
              rows.sort((a: any, b: any) => String(a?.name||'').localeCompare(String(b?.name||'')));
              setSubcategories(rows);
            }
          );
        }

        // Option groups
        unsubGrps = onSnapshot(
          collection(db, 'option-groups'),
          (snap) => {
            const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() } as any));
            rows.sort((a: any, b: any) => (Number(a?.sortOrder||0) - Number(b?.sortOrder||0)) || String(a?.name||'').localeCompare(String(b?.name||'')));
            setGroups(rows);
          }
        );

        // Menu items
        unsubItems = onSnapshot(
          collection(db, 'menuItems'),
          (snap) => {
            const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() } as any));
            rows.sort((a: any, b: any) => String(a?.name||'').localeCompare(String(b?.name||'')));
            setItems(rows);
          }
        );
      } catch (e: any) {
        setErr(e?.message || 'Error cargando datos');
      } finally {
        setLoading(false);
      }
    })();

    return () => {
      try { unsubCats && unsubCats(); } catch {}
      try { unsubSubs && unsubSubs(); } catch {}
      try { unsubGrps && unsubGrps(); } catch {}
      try { unsubItems && unsubItems(); } catch {}
    };
  }, [user, isAdmin]);

  /* =============================
     CRUD Categorías
     ============================= */
  function nextSortOrderForCategories() {
    const nums = (categories || []).map(c => Number(c.sortOrder || 0));
    const max = nums.length ? Math.max(...nums) : 0;
    return max + 1;
  }

  const onSaveCategory = async () => {
    try {
      const name = catName.trim();
      if (!name) { alert('Nombre requerido'); return; }
      if (editingCatId) {
        const patch: Partial<Category> = {
          name,
          slug: slugify(name),
        };
        await updateDocById('categories', editingCatId, patch);
      } else {
        const data: Partial<Category> = {
          name,
          slug: slugify(name),
          description: '',
          isActive: true,
          sortOrder: nextSortOrderForCategories(),
        };
        const newId = await createDoc('categories', data);
        await updateDocById('categories', newId, { id: newId });
      }
      setCatName('');
      setEditingCatId(null);
    } catch (e: any) {
      alert(e?.message || 'No se pudo guardar categoría');
    }
  };

  const onEditCategory = (c: Category) => {
    setEditingCatId(c.id);
    setCatName(c.name || '');
  };
  const onDeleteCategory = async (id: string) => {
    if (!confirm('¿Eliminar categoría? (También deberás revisar subcategorías/platos asociados)')) return;
    try {
      await deleteDocById('categories', id);
    } catch (e: any) {
      alert(e?.message || 'No se pudo eliminar');
    }
  };

  // Subir imagen categoría
  const onUploadCategoryImage = async (catId: string, file: File | null) => {
    if (!file) return;
    try {
      const current = categories.find((c) => c.id === catId);
      if (current?.imagePath) {
        try { await deleteImageByPath(current.imagePath); } catch {}
      }
      const cleanName = file.name.replace(/\s+/g, '_');
      const keyPath = `categories/${catId}/${Date.now()}_${cleanName}`;
      const up = await uploadMenuImage(file, keyPath);
      await updateDocById('categories', catId, { imageUrl: up.url, imagePath: up.path });
    } catch (e: any) {
      alert(e?.message || 'No se pudo subir la imagen de la categoría');
    }
  };

  /* =============================
     CRUD Subcategorías
     ============================= */
  function nextSortOrderForSubcats(catId: string) {
    const nums = (subcategories || [])
      .filter(s => s.categoryId === catId)
      .map(s => Number(s.sortOrder || 0));
    const max = nums.length ? Math.max(...nums) : 0;
    return max + 1;
  }

  const onSaveSubcategory = async () => {
    try {
      const name = subName.trim();
      if (!name) { alert('Nombre requerido'); return; }
      if (!subCatId) { alert('Selecciona la categoría'); return; }

      if (editingSubId) {
        await updateDocById('subcategories', editingSubId, {
          name,
          categoryId: subCatId,
        });
      } else {
        const data: Partial<Subcategory> = {
          name,
          categoryId: subCatId,
          isActive: true,
          sortOrder: nextSortOrderForSubcats(subCatId),
        };
        const newId = await createDoc('subcategories', data);
        await updateDocById('subcategories', newId, { id: newId });
      }

      setSubName('');
      setSubCatId('');
      setEditingSubId(null);
    } catch (e: any) {
      alert(e?.message || 'No se pudo guardar subcategoría');
    }
  };

  const onEditSubcategory = (s: Subcategory) => {
    setEditingSubId(s.id);
    setSubName(s.name || '');
    setSubCatId(s.categoryId || '');
  };
  const onDeleteSubcategory = async (id: string) => {
    if (!confirm('¿Eliminar subcategoría? (Revisa platos asociados)')) return;
    try {
      await deleteDocById('subcategories', id);
    } catch (e: any) {
      alert(e?.message || 'No se pudo eliminar');
    }
  };

  // Subir imagen subcategoría
  const onUploadSubcategoryImage = async (subId: string, file: File | null) => {
    if (!file) return;
    try {
      const current = subcategories.find((s) => s.id === subId);
      if (current?.imagePath) {
        try { await deleteImageByPath(current.imagePath); } catch {}
      }
      const cleanName = file.name.replace(/\s+/g, '_');
      const keyPath = `subcategories/${subId}/${Date.now()}_${cleanName}`;
      const up = await uploadMenuImage(file, keyPath);
      await updateDocById('subcategories', subId, { imageUrl: up.url, imagePath: up.path });
    } catch (e: any) {
      alert(e?.message || 'No se pudo subir la imagen de la subcategoría');
    }
  };

  /* =============================
     CRUD MenuItems (Platos)
     ============================= */
  const subcategoriesOfItemCat = useMemo(
    () => subcategories.filter((s) => !itemCatId || s.categoryId === itemCatId),
    [subcategories, itemCatId]
  );
  const filteredSubcats = useMemo(
    () => subcategories.filter((s) => !filterCat || s.categoryId === filterCat),
    [subcategories, filterCat]
  );

  const onPickImage = (f: File | null) => {
    setImageFile(f);
    if (f) {
      const url = URL.createObjectURL(f);
      setImagePreview(url);
    } else {
      setImagePreview(null);
    }
  };

  const onAddAddon = () => setAddons((prev) => [...prev, { name: '', price: 0 }]);
  const onChangeAddon = (idx: number, field: 'name' | 'price', value: string) => {
    setAddons((prev) => {
      const copy = [...prev];
      if (field === 'name') copy[idx].name = value;
      if (field === 'price') copy[idx].price = Number(value) || 0;
      return copy;
    });
  };
  const onRemoveAddon = (idx: number) => {
    setAddons((prev) => prev.filter((_, i) => i !== idx));
  };

  const onEditItem = (mi: MenuItem) => {
    setItemEditingId(mi.id);
    setItemName(mi.name || '');
    setItemPrice(String(mi.price ?? ''));
    setItemCatId(mi.categoryId || '');
    setItemSubId(mi.subcategoryId || '');
    setItemActive(mi.active !== false);
    setItemOptionGroupIds(Array.isArray(mi.optionGroupIds) ? mi.optionGroupIds : []);
    setAddons(Array.isArray(mi.addons) ? mi.addons.map(a => ({ name: a.name, price: Number(a.price || 0) })) : []);
    setImageMeta({ url: mi.imageUrl || null, path: mi.imagePath || null });
    setImageFile(null);
    setImagePreview(null);
    setItemDescription((mi as any).description || '');
  };

  const onDeleteItem = async (id: string, imgPath?: string | null) => {
    if (!confirm('¿Eliminar plato?')) return;
    try {
      await deleteDocById('menuItems', id);
      if (imgPath) await deleteImageByPath(imgPath);
      if (itemEditingId === id) resetItemForm();
    } catch (e: any) {
      alert(e?.message || 'No se pudo eliminar plato');
    }
  };

  const onSaveItem = async () => {
    try {
      const priceN = toNumber(itemPrice);
      if (!itemName.trim()) { alert('Nombre requerido'); return; }
      if (!priceN || priceN <= 0) { alert('Precio inválido'); return; }
      if (!itemCatId) { alert('Selecciona categoría'); return; }
      if (!itemSubId) { alert('Selecciona subcategoría'); return; }

      const payloadBase = {
        name: itemName.trim(),
        price: priceN,
        categoryId: itemCatId,
        subcategoryId: itemSubId,
        optionGroupIds: itemOptionGroupIds,
        addons: addons.map(a => ({ name: a.name.trim(), price: Number(a.price || 0) })).filter(a => a.name),
        active: !!itemActive,
        description: itemDescription.trim() ? itemDescription.trim() : null,
      } as Partial<MenuItem>;

      let id = itemEditingId || '';
      if (!itemEditingId) {
        id = await createDoc('menuItems', payloadBase);
      } else {
        await updateDocById('menuItems', itemEditingId, payloadBase);
      }

      if (imageFile) {
        if (imageMeta?.path) {
          try { await deleteImageByPath(imageMeta.path); } catch {}
        }
        const cleanName = imageFile.name.replace(/\s+/g, '_');
        const keyPath = `menu/${id}/${Date.now()}_${cleanName}`;
        const up = await uploadMenuImage(imageFile, keyPath);
        await updateDocById('menuItems', id, { imageUrl: up.url, imagePath: up.path });
      }

      resetItemForm();
      alert('Plato guardado.');
    } catch (e: any) {
      alert(e?.message || 'No se pudo guardar plato');
    }
  };

  // Listado de platos filtrado
  const itemsFiltered = useMemo(() => {
    return items.filter((mi) => {
      if (filterCat && mi.categoryId !== filterCat) return false;
      if (filterSub && mi.subcategoryId !== filterSub) return false;
      return true;
    });
  }, [items, filterCat, filterSub]);

  /* =============================
     NUEVO: Crear Option Group + Option Items
     ============================= */
  const addOiRow = () => {
    setOiRows((rows) => [
      ...rows,
      { name: '', priceDelta: '', isDefault: false, active: true, sortOrder: '' },
    ]);
  };
  const changeOiRow = (idx: number, field: keyof (typeof oiRows)[number], value: string | boolean) => {
    setOiRows((rows) => {
      const copy = rows.slice();
      const r = { ...copy[idx] } as any;
      r[field] = value;
      copy[idx] = r;
      return copy;
    });
  };
  const removeOiRow = (idx: number) => {
    setOiRows((rows) => rows.filter((_, i) => i !== idx));
  };

  const createOptionGroupWithItems = async () => {
    try {
      const name = ogName.trim();
      if (!name) { alert('Nombre de grupo requerido'); return; }

      // Normalizar min/max según type/required
      let min = (ogMin === '' ? undefined : Number(ogMin));
      let max = (ogMax === '' ? undefined : Number(ogMax));
      if (ogType === 'single') {
        max = 1;
        if (ogRequired) min = 1; else min = (min ?? 0);
      } else {
        if (typeof min === 'number' && min < 0) min = 0;
        if (typeof max === 'number' && max < 1) max = 1;
        if (typeof min === 'number' && typeof max === 'number' && min > max) {
          alert('min no puede ser mayor que max');
          return;
        }
      }

      const groupPayload: Partial<OptionGroup> = {
        name,
        type: ogType,
        required: ogRequired,
        min,
        max,
        active: ogActive,
        sortOrder: (ogSortOrder === '' ? undefined : Number(ogSortOrder)),
      };

      const groupId = await createDoc('option-groups', groupPayload);

      // Crear cada option-item
      const rowsValid = oiRows.filter(r => r.name.trim());
      for (const r of rowsValid) {
        const itemPayload: Partial<OptionItem> = {
          groupId,
          name: r.name.trim(),
          priceDelta: r.priceDelta === '' ? 0 : Number(r.priceDelta),
          isDefault: !!r.isDefault,
          active: !!r.active,
          sortOrder: r.sortOrder === '' ? undefined : Number(r.sortOrder),
        };
        await createDoc('option-items', itemPayload);
      }

      // Mostrar feedback y limpiar
      resetOGForm();
      setShowOGCreator(false);
      alert('Grupo y opciones creados. Ya puedes marcar el grupo en el plato.');
    } catch (e: any) {
      alert(e?.message || 'No se pudo crear el grupo/opciones');
    }
  };

  /* =========================================================================
     Render
     ========================================================================= */
  if (!authReady) return <div className="container py-3">Inicializando sesión…</div>;
  if (!user) return <div className="container py-5 text-danger">Debes iniciar sesión.</div>;
  if (!isAdmin) return <div className="container py-5 text-danger">No autorizado (solo administradores).</div>;

  return (
    <div className="container py-3">
      <div className="d-flex align-items-center justify-content-between mb-3">
        <h1 className="h4 m-0">Menú — Categorías, Subcategorías y Platos</h1>
        <span className="text-muted small">Actualización en tiempo real</span>
      </div>
      {err && <div className="alert alert-danger">{err}</div>}

      <div className="row g-3">
        {/* ===================== Columna 1: Categorías ===================== */}
        <div className="col-12 col-lg-3">
          <div className="card">
            <div className="card-header">Categorías</div>
            <div className="card-body">
              <div className="mb-2">
                <label className="form-label">Nombre</label>
                <input className="form-control" value={catName} onChange={(e) => setCatName(e.target.value)} />
              </div>
              <div className="d-flex gap-2">
                <button className="btn btn-primary btn-sm" onClick={onSaveCategory}>
                  {editingCatId ? 'Guardar cambios' : 'Crear'}
                </button>
                {editingCatId && (
                  <button className="btn btn-outline-secondary btn-sm" onClick={() => { setEditingCatId(null); setCatName(''); }}>
                    Cancelar
                  </button>
                )}
              </div>
              <hr />
              <div className="list-group">
                {categories.map((c) => (
                  <div key={c.id} className="list-group-item d-flex justify-content-between align-items-center">
                    <div className="d-flex align-items-center gap-2">
                      <div style={{ width: 48, height: 48, background: '#f8f9fa', borderRadius: 6, overflow: 'hidden' }}>
                        {c.imageUrl ? (
                          <img src={c.imageUrl} alt={c.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        ) : (
                          <div className="d-flex h-100 w-100 align-items-center justify-content-center text-muted" style={{ fontSize: 10 }}>Sin img</div>
                        )}
                      </div>
                      <div>
                        <div className="fw-semibold">{c.name}</div>
                        <div className="text-muted small">
                          slug: {c.slug || '—'} · orden: {c.sortOrder ?? '—'} · activo: {String(c.isActive ?? true)}
                        </div>
                      </div>
                    </div>
                    <div className="btn-group btn-group-sm">
                      <label className="btn btn-outline-primary">
                        Imagen
                        <input
                          type="file"
                          accept="image/*"
                          className="d-none"
                          onChange={(e) => {
                            const f = e.target.files?.[0] || null;
                            onUploadCategoryImage(c.id, f);
                            e.currentTarget.value = "";
                          }}
                        />
                      </label>
                      <button className="btn btn-outline-secondary" onClick={() => onEditCategory(c)}>Editar</button>
                      <button className="btn btn-outline-danger" onClick={() => onDeleteCategory(c.id)}>Eliminar</button>
                    </div>
                  </div>
                ))}
                {categories.length === 0 && <div className="text-muted small">No hay categorías.</div>}
              </div>
            </div>
          </div>
        </div>

        {/* ===================== Columna 2: Subcategorías ===================== */}
        <div className="col-12 col-lg-3">
          <div className="card">
            <div className="card-header">Subcategorías</div>
            <div className="card-body">
              <div className="mb-2">
                <label className="form-label">Categoría</label>
                <select className="form-select" value={subCatId} onChange={(e) => setSubCatId(e.target.value)}>
                  <option value="">Selecciona categoría…</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div className="mb-2">
                <label className="form-label">Nombre</label>
                <input className="form-control" value={subName} onChange={(e) => setSubName(e.target.value)} />
              </div>
              <div className="d-flex gap-2">
                <button className="btn btn-primary btn-sm" onClick={onSaveSubcategory}>
                  {editingSubId ? 'Guardar cambios' : 'Crear'}
                </button>
                {editingSubId && (
                  <button className="btn btn-outline-secondary btn-sm" onClick={() => { setEditingSubId(null); setSubName(''); setSubCatId(''); }}>
                    Cancelar
                  </button>
                )}
              </div>
              <hr />
              <div className="list-group">
                {subcategories.map((s) => {
                  const catName = categories.find((c) => c.id === s.categoryId)?.name || '—';
                  return (
                    <div key={s.id} className="list-group-item">
                      <div className="d-flex justify-content-between align-items-center">
                        <div className="d-flex align-items-center gap-2">
                          <div style={{ width: 44, height: 44, background: '#f8f9fa', borderRadius: 6, overflow: 'hidden' }}>
                            {s.imageUrl ? (
                              <img src={s.imageUrl} alt={s.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                            ) : (
                              <div className="d-flex h-100 w-100 align-items-center justify-content-center text-muted" style={{ fontSize: 10 }}>Sin img</div>
                            )}
                          </div>
                          <div>
                            <div className="fw-semibold">{s.name}</div>
                            <div className="text-muted small">Categoría: {catName} · orden: {s.sortOrder ?? '—'}</div>
                          </div>
                        </div>
                        <div className="btn-group btn-group-sm">
                          <label className="btn btn-outline-primary">
                            Imagen
                            <input
                              type="file"
                              accept="image/*"
                              className="d-none"
                              onChange={(e) => {
                                const f = e.target.files?.[0] || null;
                                onUploadSubcategoryImage(s.id, f);
                                e.currentTarget.value = "";
                              }}
                            />
                          </label>
                          <button className="btn btn-outline-secondary" onClick={() => onEditSubcategory(s)}>Editar</button>
                          <button className="btn btn-outline-danger" onClick={() => onDeleteSubcategory(s.id)}>Eliminar</button>
                        </div>
                      </div>
                    </div>
                  );
                })}
                {subcategories.length === 0 && <div className="text-muted small">No hay subcategorías.</div>}
              </div>
            </div>
          </div>
        </div>

        {/* ===================== Columna 3: Crear / Editar Plato ===================== */}
        <div className="col-12 col-lg-6">
          <div className="card">
            <div className="card-header">{itemEditingId ? 'Editar plato' : 'Crear plato'}</div>
            <div className="card-body">
              <div className="row g-3">
                <div className="col-12 col-md-6">
                  <label className="form-label">Categoría</label>
                  <select className="form-select" value={itemCatId} onChange={(e) => { setItemCatId(e.target.value); setItemSubId(''); }}>
                    <option value="">Selecciona categoría…</option>
                    {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div className="col-12 col-md-6">
                  <label className="form-label">Subcategoría</label>
                  <select className="form-select" value={itemSubId} onChange={(e) => setItemSubId(e.target.value)} disabled={!itemCatId}>
                    <option value="">{itemCatId ? 'Selecciona subcategoría…' : 'Selecciona una categoría primero'}</option>
                    {subcategories
                      .filter((s) => !itemCatId || s.categoryId === itemCatId)
                      .map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>

                <div className="col-12 col-md-6">
                  <label className="form-label">Nombre del plato</label>
                  <input className="form-control" value={itemName} onChange={(e) => setItemName(e.target.value)} />
                </div>
                <div className="col-12 col-md-3">
                  <label className="form-label">Precio (Q)</label>
                  <input type="number" step="0.01" className="form-control" value={itemPrice} onChange={(e) => setItemPrice(e.target.value)} />
                </div>
                <div className="col-12 col-md-3 d-flex align-items-end">
                  <div className="form-check">
                    <input className="form-check-input" type="checkbox" id="activeCheck" checked={itemActive} onChange={(e) => setItemActive(e.target.checked)} />
                    <label className="form-check-label" htmlFor="activeCheck">Activo</label>
                  </div>
                </div>

                <div className="col-12">
                  <label className="form-label">Grupos de opciones (option-groups)</label>
                  <div className="d-flex align-items-center justify-content-between mb-2">
                    <small className="text-muted">Marca los grupos aplicables a este plato.</small>
                    {/* NUEVO botón para mostrar creador inline */}
                    <button
                      type="button"
                      className="btn btn-sm btn-outline-primary"
                      onClick={() => setShowOGCreator(s => !s)}
                    >
                      {showOGCreator ? 'Ocultar' : 'Nuevo grupo + opciones'}
                    </button>
                  </div>
                  <div className="border rounded p-2" style={{ maxHeight: 160, overflow: 'auto' }}>
                    {groups.length === 0 && <div className="text-muted small">No hay grupos de opciones.</div>}
                    {groups.map((g) => {
                      const checked = itemOptionGroupIds.includes(g.id);
                      return (
                        <div key={g.id} className="form-check">
                          <input
                            className="form-check-input"
                            type="checkbox"
                            id={`g_${g.id}`}
                            checked={checked}
                            onChange={(e) => {
                              const v = e.currentTarget.checked;
                              setItemOptionGroupIds((prev) => v ? [...new Set([...prev, g.id])] : prev.filter((x) => x !== g.id));
                            }}
                          />
                          <label className="form-check-label" htmlFor={`g_${g.id}`}>
                            {g.name}
                            {g.required ? <span className="badge text-bg-light ms-1">obligatorio</span> : null}
                            {g.type ? <span className="badge text-bg-secondary ms-1">{g.type}</span> : null}
                          </label>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* ===================== NUEVO: Creador inline de Option-Group + Option-Items ===================== */}
                {showOGCreator && (
                  <div className="col-12">
                    <div className="border rounded p-3">
                      <div className="d-flex align-items-center justify-content-between mb-2">
                        <strong>Nuevo grupo de opciones</strong>
                        <button className="btn btn-sm btn-outline-secondary" onClick={() => setShowOGCreator(false)}>Cerrar</button>
                      </div>

                      <div className="row g-2">
                        <div className="col-12 col-md-6">
                          <label className="form-label">Nombre del grupo</label>
                          <input className="form-control" value={ogName} onChange={(e) => setOgName(e.target.value)} />
                        </div>
                        <div className="col-6 col-md-2">
                          <label className="form-label">Tipo</label>
                          <select className="form-select" value={ogType} onChange={(e) => setOgType(e.target.value as any)}>
                            <option value="single">single</option>
                            <option value="multi">multi</option>
                          </select>
                        </div>
                        <div className="col-6 col-md-2">
                          <label className="form-label">Orden</label>
                          <input
                            type="number"
                            className="form-control"
                            value={ogSortOrder}
                            onChange={(e) => setOgSortOrder(e.target.value === '' ? '' : Number(e.target.value))}
                          />
                        </div>
                        <div className="col-12 col-md-2 d-flex align-items-end">
                          <div className="form-check">
                            <input className="form-check-input" type="checkbox" id="ogActive" checked={ogActive} onChange={(e) => setOgActive(e.target.checked)} />
                            <label className="form-check-label" htmlFor="ogActive">Activo</label>
                          </div>
                        </div>

                        <div className="col-6 col-md-2">
                          <label className="form-label">Min</label>
                          <input
                            type="number"
                            className="form-control"
                            value={ogMin}
                            onChange={(e) => setOgMin(e.target.value === '' ? '' : Number(e.target.value))}
                          />
                        </div>
                        <div className="col-6 col-md-2">
                          <label className="form-label">Max</label>
                          <input
                            type="number"
                            className="form-control"
                            value={ogMax}
                            onChange={(e) => setOgMax(e.target.value === '' ? '' : Number(e.target.value))}
                          />
                        </div>
                        <div className="col-12 col-md-2 d-flex align-items-end">
                          <div className="form-check">
                            <input className="form-check-input" type="checkbox" id="ogReq" checked={ogRequired} onChange={(e) => setOgRequired(e.target.checked)} />
                            <label className="form-check-label" htmlFor="ogReq">Requerido</label>
                          </div>
                        </div>
                      </div>

                      <hr className="my-3" />
                      <div className="d-flex align-items-center justify-content-between mb-2">
                        <strong>Opciones de este grupo</strong>
                        <button className="btn btn-sm btn-outline-primary" onClick={addOiRow}>+ Agregar opción</button>
                      </div>

                      {oiRows.length === 0 && <div className="text-muted small">Aún no has agregado opciones.</div>}

                      {oiRows.map((r, idx) => (
                        <div key={idx} className="row g-2 align-items-end mb-2">
                          <div className="col-12 col-md-4">
                            <label className="form-label">Nombre</label>
                            <input className="form-control form-control-sm" value={r.name} onChange={(e) => changeOiRow(idx, 'name', e.target.value)} />
                          </div>
                          <div className="col-6 col-md-2">
                            <label className="form-label">Δ Precio</label>
                            <input
                              type="number"
                              step="0.01"
                              className="form-control form-control-sm"
                              value={r.priceDelta}
                              onChange={(e) => changeOiRow(idx, 'priceDelta', e.target.value)}
                            />
                          </div>
                          <div className="col-6 col-md-2">
                            <label className="form-label">Orden</label>
                            <input
                              type="number"
                              className="form-control form-control-sm"
                              value={r.sortOrder}
                              onChange={(e) => changeOiRow(idx, 'sortOrder', e.target.value)}
                            />
                          </div>
                          <div className="col-6 col-md-2">
                            <div className="form-check">
                              <input className="form-check-input" type="checkbox" id={`oiDef_${idx}`} checked={r.isDefault} onChange={(e) => changeOiRow(idx, 'isDefault', e.target.checked)} />
                              <label className="form-check-label" htmlFor={`oiDef_${idx}`}>Default</label>
                            </div>
                          </div>
                          <div className="col-6 col-md-2">
                            <div className="form-check">
                              <input className="form-check-input" type="checkbox" id={`oiAct_${idx}`} checked={r.active} onChange={(e) => changeOiRow(idx, 'active', e.target.checked)} />
                              <label className="form-check-label" htmlFor={`oiAct_${idx}`}>Activo</label>
                            </div>
                          </div>
                          <div className="col-12 text-end">
                            <button className="btn btn-outline-danger btn-sm" onClick={() => removeOiRow(idx)}>Eliminar</button>
                          </div>
                        </div>
                      ))}

                      <div className="text-end mt-3">
                        <button className="btn btn-primary" onClick={createOptionGroupWithItems}>
                          Crear grupo + opciones
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Descripción del plato */}
                <div className="col-12">
                  <label className="form-label">Descripción (visible solo en el Menú)</label>
                  <textarea
                    className="form-control"
                    rows={3}
                    placeholder="Describe brevemente el plato (opcional)"
                    value={itemDescription}
                    onChange={(e) => setItemDescription(e.target.value)}
                  />
                </div>

                {/* Addons */}
                <div className="col-12">
                  <label className="form-label d-flex align-items-center justify-content-between">
                    <span>Addons (extras por precio)</span>
                    <button type="button" className="btn btn-outline-primary btn-sm" onClick={onAddAddon}>+ Agregar addon</button>
                  </label>
                  {addons.length === 0 && <div className="text-muted small">Sin addons.</div>}
                  {addons.map((a, idx) => (
                    <div key={idx} className="row g-2 align-items-center mb-1">
                      <div className="col-7">
                        <input className="form-control form-control-sm" placeholder="Nombre" value={a.name} onChange={(e) => onChangeAddon(idx, 'name', e.target.value)} />
                      </div>
                      <div className="col-3">
                        <input type="number" step="0.01" className="form-control form-control-sm" placeholder="Precio" value={a.price} onChange={(e) => onChangeAddon(idx, 'price', e.target.value)} />
                      </div>
                      <div className="col-2 text-end">
                        <button type="button" className="btn btn-outline-danger btn-sm" onClick={() => onRemoveAddon(idx)}>Eliminar</button>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Imagen */}
                <div className="col-12 col-md-8">
                  <ImagePicker
                    imagePreview={imagePreview}
                    imageMetaUrl={(imageMeta as any)?.url || null}
                    onPick={(f) => {
                      setImageFile(f);
                      setImagePreview(f ? URL.createObjectURL(f) : null);
                    }}
                  />
                </div>
                <div className="col-12 col-md-4 d-flex align-items-end">
                  <div className="d-flex gap-2">
                    <button className="btn btn-primary" onClick={onSaveItem}>
                      {itemEditingId ? 'Guardar cambios' : 'Crear plato'}
                    </button>
                    {itemEditingId && (
                      <button className="btn btn-outline-secondary" onClick={resetItemForm}>Cancelar</button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* ===================== Listado de Platos ===================== */}
          <div className="card mt-3">
            <div className="card-header">
              Platos
              <div className="float-end">
                <select className="form-select form-select-sm d-inline-block me-2" style={{ width: 200 }} value={filterCat} onChange={(e) => { setFilterCat(e.target.value); setFilterSub(''); }}>
                  <option value="">(Todas las categorías)</option>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <select className="form-select form-select-sm d-inline-block" style={{ width: 200 }} value={filterSub} onChange={(e) => setFilterSub(e.target.value)}>
                  <option value="">(Todas las subcategorías)</option>
                  {subcategories
                    .filter((s) => !filterCat || s.categoryId === filterCat)
                    .map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
            </div>
            <div className="card-body">
              {itemsFiltered.length === 0 && <div className="text-muted small">Sin resultados.</div>}
              <div className="row g-3">
                {itemsFiltered.map((mi) => {
                  const cName = categories.find((c) => c.id === mi.categoryId)?.name || '—';
                  const sName = subcategories.find((s) => s.id === mi.subcategoryId)?.name || '—';
                  const gNames = (mi.optionGroupIds || []).map((gid) => groups.find((g) => g.id === gid)?.name).filter(Boolean) as string[];
                  return (
                    <div key={mi.id} className="col-12 col-md-6">
                      <div className="card h-100">
                        <div className="card-body">
                          <div className="d-flex gap-3">
                            <div style={{ width: 96, height: 96, background: '#f8f9fa', borderRadius: 8, overflow: 'hidden' }}>
                              {mi.imageUrl ? (
                                <img src={mi.imageUrl} alt={mi.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                              ) : (
                                <div className="d-flex h-100 w-100 align-items-center justify-content-center text-muted small">Sin imagen</div>
                              )}
                            </div>
                            <div className="flex-fill">
                              <div className="d-flex justify-content-between">
                                <div className="fw-semibold">{mi.name}</div>
                                <div className="fw-semibold">{fmtQ(mi.price)}</div>
                              </div>
                              <div className="text-muted small">
                                {cName} · {sName} {mi.active === false ? <span className="badge text-bg-warning ms-1">inactivo</span> : null}
                              </div>
                              {!!gNames.length && (
                                <div className="text-muted small mt-1">Grupos: {gNames.join(', ')}</div>
                              )}
                              {!!mi.addons?.length && (
                                <div className="text-muted small mt-1">
                                  Addons: {mi.addons.map(a => `${a.name} (${fmtQ(a.price)})`).join(', ')}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="card-footer d-flex justify-content-end gap-2">
                          <button className="btn btn-outline-secondary btn-sm" onClick={() => onEditItem(mi)}>Editar</button>
                          <button className="btn btn-outline-danger btn-sm" onClick={() => onDeleteItem(mi.id, mi.imagePath)}>Eliminar</button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}

/* Pequeño componente para la imagen */
function ImagePicker({
  imagePreview,
  imageMetaUrl,
  onPick,
}: {
  imagePreview: string | null;
  imageMetaUrl: string | null;
  onPick: (f: File | null) => void;
}) {
  return (
    <>
      <label className="form-label">Imagen (Storage)</label>
      <input
        type="file"
        accept="image/*"
        className="form-control"
        onChange={(e) => onPick(e.target.files?.[0] || null)}
      />
      {!!imagePreview && (
        <div className="mt-2">
          <img src={imagePreview} alt="preview" style={{ maxWidth: '100%', maxHeight: 180, objectFit: 'contain' }} />
        </div>
      )}
      {!imagePreview && imageMetaUrl && (
        <div className="mt-2">
          <img src={imageMetaUrl} alt="current" style={{ maxWidth: '100%', maxHeight: 180, objectFit: 'contain' }} />
        </div>
      )}
      {imageMetaUrl && (
        <div className="text-muted small mt-1">
          Imagen actual: <a href={imageMetaUrl} target="_blank" rel="noopener noreferrer">ver</a>
        </div>
      )}
    </>
  );
}

export default function AdminMenuPage() {
  return (
    <OnlyAdmin>
      <AdminMenuPage_Inner />
    </OnlyAdmin>
  );
}
