// src/app/admin/home-configure
'use client';

import React, { useEffect, useRef, useState } from 'react';
import Protected from '@/components/Protected';
import { OnlyAdmin } from '@/components/Only';
import '@/lib/firebase/client';

import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
  collection,
  getDocs,
  query,
} from 'firebase/firestore';

import {
  getStorage,
  ref as storageRef,
  uploadBytes,
  getDownloadURL,
} from 'firebase/storage';

/* ===========================================================
   Tipos locales
   =========================================================== */

type TimestampLike = any;

type HeroSlide = {
  imageUrl: string;
  imageAlt?: string;
  headline: string;
  sub?: string;
  cta?: { label?: string; href?: string };
  overlay?: 'dark' | 'light' | 'none';
};

type HeroVideo = {
  url: string;
  posterUrl?: string;
  autoplay?: boolean;
  loop?: boolean;
  muted?: boolean;
};

type PromoEntry = {
  id: string;
  title: string;
  subtitle?: string;
  badge?: 'primary' | 'success' | 'warning' | 'danger' | 'info';
  imageUrl?: string;
  discountPct?: number;
  startAt?: TimestampLike;
  endAt?: TimestampLike;
  // href?: string; // ⚠️ seguimos soportando en datos si ya existe, pero NO se edita en UI
  active: boolean;
  menuItemIds?: string[];
  couponIds?: string[];
};

type FeaturedMenuItem = {
  menuItemId: string;
  name: string;
  price: number;
  imageUrl?: string;
  tags?: string[];
};

type HomeConfig = {
  updatedAt?: TimestampLike;
  hero: {
    variant: 'image' | 'carousel' | 'video';
    slides?: HeroSlide[];
    video?: HeroVideo;
  };
  promos: PromoEntry[];
  featuredMenu: {
    title?: string;
    categoryIds?: string[];
    subcategoryIds?: string[];   // 👈 nuevo
    itemIds?: string[];          // 👈 nuevo (selección explícita de items)
    items: FeaturedMenuItem[];   // (opcional legacy)
  };
  gallery: { images: Array<{ url: string; alt?: string }> };
  seo?: { title?: string; description?: string; ogImage?: string; keywords?: string[] };

  /* 👇 NUEVO: About Us */
  aboutUs?: {
    title?: string;
    text?: string;
    imageUrl?: string;
  };

  publish: { status: 'draft' | 'published'; version: number };
};

/* ===========================================================
   Helpers de compresión/redimensión de imágenes en el cliente
   =========================================================== */

async function compressImageFile(
  file: File,
  opts: { maxW: number; maxH: number; quality: number }
) {
  const { maxW, maxH, quality } = opts;
  const imgBitmap = await createImageBitmap(file);
  const { width, height } = imgBitmap;

  const ratio = Math.min(maxW / width, maxH / height, 1);
  const targetW = Math.round(width * ratio);
  const targetH = Math.round(height * ratio);

  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No 2D context');
  ctx.drawImage(imgBitmap, 0, 0, targetW, targetH);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), 'image/jpeg', quality)
  );
  if (!blob) throw new Error('No blob produced by canvas.toBlob');
  return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
}

async function uploadToStorage(path: string, file: File): Promise<string> {
  const storage = getStorage();
  const ref = storageRef(storage, path);
  await uploadBytes(ref, file);
  const url = await getDownloadURL(ref);
  return url;
}

/* ===========================================================
   Helpers de YouTube (para autoplay confiable)
   =========================================================== */

function ytId(u: string) {
  try {
    const url = new URL(u);
    if (url.hostname.includes('youtu.be')) return url.pathname.slice(1);
    if (url.searchParams.get('v')) return url.searchParams.get('v')!;
    const parts = url.pathname.split('/');
    const i = parts.indexOf('embed');
    if (i >= 0 && parts[i + 1]) return parts[i + 1];
  } catch {}
  return null;
}

function buildYtEmbedUrl(id: string, opts: { autoplay?: boolean; muted?: boolean; loop?: boolean }) {
  const ap = opts.autoplay ? 1 : 0;
  const mu = opts.autoplay ? 1 : (opts.muted ? 1 : 0);
  const params = new URLSearchParams({
    rel: '0',
    modestbranding: '1',
    controls: '1',
    playsinline: '1',
    autoplay: String(ap),
    mute: String(mu),
  });
  return `https://www.youtube-nocookie.com/embed/${id}?${params.toString()}`;
}

function maybeNormalizeYouTubeUrl(raw: string, opts: { autoplay?: boolean; muted?: boolean; loop?: boolean }) {
  const id = ytId(raw);
  if (!id) return raw;
  return buildYtEmbedUrl(id, opts);
}

/* ===========================================================
   Cargas base (categorías, subcategorías, items, cupones)
   =========================================================== */

type Category = { id: string; name: string };
type Subcategory = { id: string; name: string; categoryId?: string };
type MenuItem = { id: string; name: string; price?: number; imageUrl?: string; categoryId?: string; subcategoryId?: string };
type Coupon = { id: string; code: string; label?: string; discountPct?: number; active?: boolean };

async function fetchCategories(): Promise<Category[]> {
  const db = getFirestore();
  const snap = await getDocs(collection(db, 'categories'));
  return snap.docs
    .map((d) => ({ id: d.id, ...(d.data() as any) }))
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}

async function fetchSubcategories(): Promise<Subcategory[]> {
  const db = getFirestore();
  const snap = await getDocs(collection(db, 'subcategories'));
  return snap.docs
    .map((d) => ({ id: d.id, ...(d.data() as any) }))
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}

async function fetchMenuItems(): Promise<MenuItem[]> {
  const db = getFirestore();
  const qy = query(collection(db, 'menuItems'));
  const snap = await getDocs(qy);
  return snap.docs
    .map((d) => ({ id: d.id, ...(d.data() as any) }))
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}

/** ⬇️ Leer cupones desde la colección `promotions` (solo name y code) */
async function fetchCoupons(): Promise<Coupon[]> {
  const db = getFirestore();
  const snap = await getDocs(collection(db, 'promotions'));
  const list = snap.docs.map((d) => {
    const data = d.data() as any;
    const code = typeof data?.code === 'string' ? data.code : '';
    const label = typeof data?.name === 'string' ? data.name : undefined;
    const discountPct = typeof data?.value === 'number' && data?.type === 'percent' ? data.value : undefined;
    const active = typeof data?.active === 'boolean' ? data.active : undefined;
    return { id: d.id, code, label, discountPct, active } as Coupon;
  });
  // Solo mostrar los que tengan code
  return list.filter((c) => !!c.code).sort((a, b) => (a.label || '').localeCompare(b.label || ''));
}

/* ===========================================================
   Página principal
   =========================================================== */

export default function AdminHomeConfigurePage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [cfg, setCfg] = useState<HomeConfig>({
    hero: { variant: 'image', slides: [] },
    promos: [],
    featuredMenu: { title: 'Featured', categoryIds: [], subcategoryIds: [], itemIds: [], items: [] },
    gallery: { images: [] },
    seo: { title: '', description: '', ogImage: '', keywords: [] },

    /* 👇 NUEVO: estado inicial About Us */
    aboutUs: { title: '', text: '', imageUrl: '' },

    publish: { status: 'draft', version: 1 },
  });

  const [categories, setCategories] = useState<Category[]>([]);
  const [subcategories, setSubcategories] = useState<Subcategory[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [tab, setTab] = useState<'hero' | 'promos' | 'featured' | 'gallery' | 'about' | 'seo' | 'publish'>('hero');

  useEffect(() => {
    (async () => {
      try {
        const db = getFirestore();
        const ref = doc(db, 'settings', 'homeConfig');
        const snap = await getDoc(ref);

        const [cats, subs, items, coups] = await Promise.all([
          fetchCategories(),
          fetchSubcategories(),
          fetchMenuItems(),
          fetchCoupons(),
        ]);

        setCategories(cats);
        setSubcategories(subs);
        setMenuItems(items);
        setCoupons(coups);

        if (snap.exists()) {
          const data = snap.data() as HomeConfig;
          // Ensure new arrays exist
          data.featuredMenu = {
            title: data.featuredMenu?.title ?? 'Featured',
            categoryIds: data.featuredMenu?.categoryIds ?? [],
            subcategoryIds: data.featuredMenu?.subcategoryIds ?? [],
            itemIds: data.featuredMenu?.itemIds ?? [],
            items: data.featuredMenu?.items ?? [],
          };

          /* 👇 NUEVO: asegurar estructura About Us */
          data.aboutUs = {
            title: data.aboutUs?.title ?? '',
            text: data.aboutUs?.text ?? '',
            imageUrl: data.aboutUs?.imageUrl ?? '',
          };

          setCfg(data);
        }
      } catch (e) {
        console.error('[home-configure] load error', e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  /* ===========================
     Helpers de actualización segura
     =========================== */

  function setHero(patch: Partial<HomeConfig['hero']>) {
    setCfg((prev) => ({ ...prev, hero: { ...prev.hero, ...patch } }));
  }

  function setHeroSlides(updater: (slides: HeroSlide[]) => HeroSlide[]) {
    setCfg((prev) => {
      const slides = Array.isArray(prev.hero.slides) ? prev.hero.slides : [];
      return { ...prev, hero: { ...prev.hero, slides: updater(slides) } };
    });
  }

  function setHeroVideo(patch: Partial<HeroVideo>) {
    setCfg((prev) => {
      const video: HeroVideo = { ...(prev.hero.video || { url: '', muted: true, autoplay: true, loop: true }), ...patch };
      return { ...prev, hero: { ...prev.hero, video } };
    });
  }

  /* ===========================
     Acciones guardar/publicar
     =========================== */

  async function saveDraft() {
    setSaving(true);
    try {
      const db = getFirestore();
      const ref = doc(db, 'settings', 'homeConfig');
      const next: HomeConfig = {
        ...cfg,
        updatedAt: serverTimestamp(),
        publish: { ...(cfg.publish || { version: 1, status: 'draft' }), status: 'draft' },
      };
      await setDoc(ref, next, { merge: true });
      setCfg(next);
    } catch (e) {
      console.error('[home-configure] saveDraft error', e);
      alert('Error saving draft');
    } finally {
      setSaving(false);
    }
  }

  async function publishNow() {
    setSaving(true);
    try {
      const db = getFirestore();
      const ref = doc(db, 'settings', 'homeConfig');
      const next: HomeConfig = {
        ...cfg,
        updatedAt: serverTimestamp(),
        publish: { version: (cfg.publish?.version || 0) + 1, status: 'published' },
      };
      await setDoc(ref, next, { merge: true });
      setCfg(next);
    } catch (e) {
      console.error('[home-configure] publish error', e);
      alert('Error publishing');
    } finally {
      setSaving(false);
    }
  }

  /* ===========================
     Subidas de imágenes
     =========================== */

  const imgInputRef = useRef<HTMLInputElement | null>(null);
  async function handleAddHeroImage() {
    const input = imgInputRef.current;
    if (!input || !input.files?.length) return;

    const raw = input.files[0];
    const compressed = await compressImageFile(raw, { maxW: 1920, maxH: 1080, quality: 0.8 });
    const path = `home/hero/${Date.now()}-${compressed.name}`;
    const url = await uploadToStorage(path, compressed);

    const newSlide: HeroSlide = {
      imageUrl: url,
      headline: 'Delicious moments',
      sub: 'Your favorite dishes, fast & fresh.',
      overlay: 'dark',
    };
    setHeroSlides((slides) => [...slides, newSlide]);

    input.value = '';
  }

  const galleryInputRef = useRef<HTMLInputElement | null>(null);
  async function handleAddGalleryImage() {
    const input = galleryInputRef.current;
    if (!input || !input.files?.length) return;

    const raw = input.files[0];
    const compressed = await compressImageFile(raw, { maxW: 1600, maxH: 1200, quality: 0.8 });
    const path = `home/gallery/${Date.now()}-${compressed.name}`;
    const url = await uploadToStorage(path, compressed);

    setCfg((prev) => ({
      ...prev,
      gallery: { images: [...(prev.gallery.images || []), { url, alt: 'Gallery image' }] },
    }));

    input.value = '';
  }

  /* === NUEVO: imagen About Us === */
  const aboutImageInputRef = useRef<HTMLInputElement | null>(null);
  async function handleUploadAboutImage() {
    const input = aboutImageInputRef.current;
    if (!input || !input.files?.length) return;
    const raw = input.files[0];
    const compressed = await compressImageFile(raw, { maxW: 1600, maxH: 1200, quality: 0.85 });
    const path = `home/about/${Date.now()}-${compressed.name}`;
    const url = await uploadToStorage(path, compressed);
    setCfg((prev) => ({ ...prev, aboutUs: { ...(prev.aboutUs || {}), imageUrl: url } }));
    input.value = '';
  }

  /* ===========================
     Video (URL o Subida) — máx 300MB
     =========================== */

  const videoInputRef = useRef<HTMLInputElement | null>(null);

  async function handleUploadVideo() {
    const input = videoInputRef.current;
    if (!input || !input.files?.length) return;
    const raw = input.files[0];
    if (!/^video\/mp4$/i.test(raw.type)) {
      alert('Solo se permite MP4');
      return;
    }
    if (raw.size > 300 * 1024 * 1024) {
      alert('El video excede 300MB. Por favor, comprímelo.');
      return;
    }
    const path = `home/hero/video/${Date.now()}-${raw.name}`;
    const url = await uploadToStorage(path, raw);
    setHeroVideo({ url });
    input.value = '';
  }

  const posterInputRef = useRef<HTMLInputElement | null>(null);
  async function handleUploadPoster() {
    const input = posterInputRef.current;
    if (!input || !input.files?.length) return;

    const raw = input.files[0];
    const compressed = await compressImageFile(raw, { maxW: 1920, maxH: 1080, quality: 0.8 });
    const path = `home/hero/video/posters/${Date.now()}-${compressed.name}`;
    const url = await uploadToStorage(path, compressed);
    setHeroVideo({ posterUrl: url });
    input.value = '';
  }

  /* ===========================
     Hero: variant
     =========================== */

  function onHeroVariantChange(v: 'image' | 'carousel' | 'video') {
    if (v === 'video') {
      setHero({
        variant: v,
        video: { ...(cfg.hero.video || { url: '', muted: true, autoplay: true, loop: true }) },
      });
    } else {
      setHero({ variant: v });
    }
  }

  /* ===========================
     Featured Menu: categorías, subcategorías e items
     =========================== */

  function toggleInArray<T extends string>(arr: T[] | undefined, id: T): T[] {
    const base = arr || [];
    return base.includes(id) ? base.filter((x) => x !== id) : [...base, id];
  }

  function toggleCategory(catId: string) {
    setCfg((prev) => ({
      ...prev,
      featuredMenu: { ...prev.featuredMenu, categoryIds: toggleInArray(prev.featuredMenu.categoryIds, catId) },
    }));
  }
  function toggleSubcategory(subId: string) {
    setCfg((prev) => ({
      ...prev,
      featuredMenu: { ...prev.featuredMenu, subcategoryIds: toggleInArray(prev.featuredMenu.subcategoryIds, subId) },
    }));
  }
  function toggleItem(itemId: string) {
    setCfg((prev) => ({
      ...prev,
      featuredMenu: { ...prev.featuredMenu, itemIds: toggleInArray(prev.featuredMenu.itemIds, itemId) },
    }));
  }

  /* ===========================
     Promos: platos y cupones
     =========================== */

  function addEmptyPromo() {
    const p: PromoEntry = {
      id: typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Date.now()),
      title: 'New Promo',
      active: true,
      badge: 'warning',
      discountPct: 10,
      menuItemIds: [],
      couponIds: [],
    };
    setCfg((prev) => ({ ...prev, promos: [...prev.promos, p] }));
  }

  function updatePromo(id: string, patch: Partial<PromoEntry>) {
    setCfg((prev) => ({
      ...prev,
      promos: prev.promos.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    }));
  }

  function removePromo(id: string) {
    setCfg((prev) => ({ ...prev, promos: prev.promos.filter((p) => p.id !== id) }));
  }

  /* ===========================
     Gallery Carousel (admin preview)
     =========================== */
  const [galleryIdx, setGalleryIdx] = useState(0);
  useEffect(() => {
    const imgs = cfg.gallery.images || [];
    if (imgs.length <= 1) return;
    const t = setInterval(() => {
      setGalleryIdx((i) => (i + 1) % imgs.length);
    }, 3000);
    return () => clearInterval(t);
  }, [cfg.gallery.images]);

  /* ===========================
     Render
     =========================== */

  if (loading) {
    return (
      <Protected>
        <OnlyAdmin>
          <div className="container py-5 text-center">
            <div className="spinner-border" role="status" />
            <div className="mt-2">Loading…</div>
          </div>
        </OnlyAdmin>
      </Protected>
    );
  }

  return (
    <Protected>
      <OnlyAdmin>
        <div className="container py-4">
          <div className="d-flex align-items-center justify-content-between mb-3">
            <h1 className="h4 m-0">Home Configure</h1>
            <div className="d-flex gap-2">
              <button className="btn btn-outline-secondary" disabled={saving} onClick={saveDraft}>
                {saving ? 'Saving…' : 'Save draft'}
              </button>
              <button className="btn btn-primary" disabled={saving} onClick={publishNow}>
                {saving ? 'Publishing…' : 'Publish'}
              </button>
            </div>
          </div>

          {/* Tabs */}
          <ul className="nav nav-tabs mb-3">
            {[
              { k: 'hero', label: 'Hero' },
              { k: 'promos', label: 'Promotions' },
              { k: 'featured', label: 'Featured Menu' },
              { k: 'gallery', label: 'Gallery' },
              { k: 'about', label: 'About Us' }, // 👈 NUEVO
              { k: 'seo', label: 'SEO' },
              { k: 'publish', label: 'Publish' },
            ].map((t) => (
              <li className="nav-item" key={t.k}>
                <button
                  className={`nav-link ${tab === (t.k as any) ? 'active' : ''}`}
                  onClick={() => setTab(t.k as any)}
                >
                  {t.label}
                </button>
              </li>
            ))}
          </ul>

          {/* === HERO === */}
          {tab === 'hero' && (
            <div className="card shadow-sm">
              <div className="card-body">
                <div className="row g-3">
                  <div className="col-md-4">
                    <label className="form-label">Variant</label>
                    <select
                      className="form-select"
                      value={cfg.hero.variant}
                      onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
                        onHeroVariantChange(e.target.value as 'image' | 'carousel' | 'video')
                      }
                    >
                      <option value="image">Single image</option>
                      <option value="carousel">Carousel</option>
                      <option value="video">Video</option>
                    </select>
                  </div>
                </div>

                {/* Image / Carousel */}
                {(cfg.hero.variant === 'image' || cfg.hero.variant === 'carousel') && (
                  <>
                    <hr />
                    <div className="d-flex align-items-center gap-2 mb-2">
                      <input ref={imgInputRef} type="file" accept="image/*" className="form-control" />
                      <button className="btn btn-outline-primary" onClick={handleAddHeroImage}>
                        Add slide (auto-compress)
                      </button>
                    </div>

                    <div className="row g-3">
                      {(cfg.hero.slides || []).map((s, idx) => (
                        <div className="col-md-6" key={idx}>
                          <div className="card h-100">
                            <img src={s.imageUrl} className="card-img-top" alt={s.imageAlt || 'slide'} />
                            <div className="card-body">
                              <div className="mb-2">
                                <label className="form-label">Headline</label>
                                <input
                                  className="form-control"
                                  value={s.headline}
                                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                                    setHeroSlides((slides) => {
                                      const next = [...slides];
                                      next[idx] = { ...next[idx], headline: e.target.value };
                                      return next;
                                    })
                                  }
                                />
                              </div>
                              <div className="mb-2">
                                <label className="form-label">Subheadline</label>
                                <input
                                  className="form-control"
                                  value={s.sub || ''}
                                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                                    setHeroSlides((slides) => {
                                      const next = [...slides];
                                      next[idx] = { ...next[idx], sub: e.target.value };
                                      return next;
                                    })
                                  }
                                />
                              </div>
                              <div className="row g-2">
                                <div className="col-6">
                                  <label className="form-label">CTA label</label>
                                  <input
                                    className="form-control"
                                    value={s.cta?.label || ''}
                                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                                      setHeroSlides((slides) => {
                                        const next = [...slides];
                                        const prevSlide = next[idx] || {};
                                        const prevCta = (prevSlide as HeroSlide).cta || {};
                                        next[idx] = { ...(prevSlide as HeroSlide), cta: { ...prevCta, label: e.target.value } };
                                        return next;
                                      })
                                    }
                                  />
                                </div>
                                <div className="col-6">
                                  <label className="form-label">CTA href</label>
                                  <input
                                    className="form-control"
                                    value={s.cta?.href || ''}
                                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                                      setHeroSlides((slides) => {
                                        const next = [...slides];
                                        const prevSlide = next[idx] || {};
                                        const prevCta = (prevSlide as HeroSlide).cta || {};
                                        next[idx] = { ...(prevSlide as HeroSlide), cta: { ...prevCta, href: e.target.value } };
                                        return next;
                                      })
                                    }
                                  />
                                </div>
                              </div>
                              <div className="mt-2">
                                <label className="form-label">Overlay</label>
                                <select
                                  className="form-select"
                                  value={s.overlay || 'dark'}
                                  onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
                                    setHeroSlides((slides) => {
                                      const next = [...slides];
                                      next[idx] = { ...next[idx], overlay: e.target.value as 'dark' | 'light' | 'none' };
                                      return next;
                                    })
                                  }
                                >
                                  <option value="dark">Dark</option>
                                  <option value="light">Light</option>
                                  <option value="none">None</option>
                                </select>
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}

                {/* Video */}
                {cfg.hero.variant === 'video' && (
                  <>
                    <hr />
                    <div className="alert alert-info">
                      Puedes usar URL (YouTube/Vimeo/MP4) o subir un MP4 (máx 300MB). Recomiendo subir un
                      <strong> poster</strong> para el primer render.
                    </div>

                    <div className="row g-3">
                      <div className="col-md-6">
                        <label className="form-label">Video URL</label>
                        <input
                          className="form-control"
                          placeholder="https://... (mp4, youtube, vimeo)"
                          value={cfg.hero.video?.url || ''}
                          onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                            const urlRaw = e.target.value;
                            const vopts = {
                              autoplay: !!cfg.hero.video?.autoplay,
                              muted: !!cfg.hero.video?.muted,
                              loop: !!cfg.hero.video?.loop,
                            };
                            const normalized = maybeNormalizeYouTubeUrl(urlRaw, vopts);
                            setHeroVideo({ url: normalized });
                          }}
                        />
                        <div className="small text-muted mt-1">
                          Si es YouTube/Vimeo, renderizaremos el embed; si es MP4, usaremos &lt;video&gt; HTML5.
                        </div>
                      </div>
                      <div className="col-md-6">
                        <label className="form-label">Subir MP4 (máx 300MB)</label>
                        <div className="d-flex gap-2">
                          <input ref={videoInputRef} type="file" accept="video/mp4" className="form-control" />
                          <button className="btn btn-outline-primary" onClick={handleUploadVideo}>Upload</button>
                        </div>
                      </div>

                      <div className="col-md-6">
                        <label className="form-label">Poster (imagen)</label>
                        <div className="d-flex gap-2">
                          <input ref={posterInputRef} type="file" accept="image/*" className="form-control" />
                          <button className="btn btn-outline-primary" onClick={handleUploadPoster}>Upload poster</button>
                        </div>
                      </div>

                      <div className="col-md-6">
                        <label className="form-label">Playback</label>
                        <div className="row g-2">
                          <div className="col-4">
                            <div className="form-check">
                              <input
                                id="autoplay"
                                className="form-check-input"
                                type="checkbox"
                                checked={!!cfg.hero.video?.autoplay}
                                onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                                  const checked = e.target.checked;
                                  const currentUrl = cfg.hero.video?.url || '';
                                  const normalized = maybeNormalizeYouTubeUrl(currentUrl, {
                                    autoplay: checked,
                                    muted: checked ? true : !!cfg.hero.video?.muted,
                                    loop: !!cfg.hero.video?.loop,
                                  });
                                  setHeroVideo({
                                    autoplay: checked,
                                    muted: checked ? true : cfg.hero.video?.muted,
                                    url: normalized,
                                  });
                                }}
                              />
                              <label className="form-check-label" htmlFor="autoplay">Autoplay</label>
                            </div>
                          </div>
                          <div className="col-4">
                            <div className="form-check">
                              <input
                                id="loop"
                                className="form-check-input"
                                type="checkbox"
                                checked={!!cfg.hero.video?.loop}
                                onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                                  const checked = e.target.checked;
                                  const currentUrl = cfg.hero.video?.url || '';
                                  const normalized = maybeNormalizeYouTubeUrl(currentUrl, {
                                    autoplay: !!cfg.hero.video?.autoplay,
                                    muted: !!cfg.hero.video?.muted,
                                    loop: checked,
                                  });
                                  setHeroVideo({ loop: checked, url: normalized });
                                }}
                              />
                              <label className="form-check-label" htmlFor="loop">Loop</label>
                            </div>
                          </div>
                          <div className="col-4">
                            <div className="form-check">
                              <input
                                id="muted"
                                className="form-check-input"
                                type="checkbox"
                                checked={!!cfg.hero.video?.muted}
                                onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                                  const checked = e.target.checked;
                                  const currentUrl = cfg.hero.video?.url || '';
                                  const normalized = maybeNormalizeYouTubeUrl(currentUrl, {
                                    autoplay: !!cfg.hero.video?.autoplay,
                                    muted: checked,
                                    loop: !!cfg.hero.video?.loop,
                                  });
                                  setHeroVideo({ muted: checked, url: normalized });
                                }}
                              />
                              <label className="form-check-label" htmlFor="muted">Muted</label>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {/* === PROMOS === */}
          {tab === 'promos' && (
            <div className="card shadow-sm border-0">
              <div className="card-body">
                <div className="d-flex justify-content-between align-items-center mb-3">
                  <div>
                    <h2 className="h5 m-0">Promotions</h2>
                    <small className="text-muted">Resalta tus promos con imágenes de los platos seleccionados.</small>
                  </div>
                <button className="btn btn-primary" onClick={addEmptyPromo}>
                    + Add promotion
                  </button>
                </div>

                {(cfg.promos || []).length === 0 && <div className="text-muted">No promotions yet.</div>}

                <div className="row g-3">
                  {cfg.promos.map((p) => {
                    const dishes = (p.menuItemIds || [])
                      .map((id) => menuItems.find((m) => m.id === id))
                      .filter(Boolean) as MenuItem[];

                    // Valor seleccionado para "cover" según la imageUrl actual
                    const selectedCoverId =
                      dishes.find((d) => d.imageUrl && d.imageUrl === p.imageUrl)?.id || '';

                    return (
                      <div className="col-md-6" key={p.id}>
                        <div className="card h-100 shadow-sm overflow-hidden">
                          <div className="position-relative p-3 bg-gradient" style={{ background: 'linear-gradient(135deg, #ffe29f 0%, #ffa99f 48%, #ff719a 100%)' }}>
                            <span className={`badge bg-${p.badge || 'warning'} text-uppercase`}>{p.badge || 'warning'}</span>
                            <div className="form-check form-switch position-absolute top-0 end-0 m-3">
                              <input
                                className="form-check-input"
                                type="checkbox"
                                id={`active-${p.id}`}
                                checked={p.active}
                                onChange={(e) => updatePromo(p.id, { active: e.target.checked })}
                              />
                              <label className="form-check-label text-dark small" htmlFor={`active-${p.id}`}>Active</label>
                            </div>
                            <div className="mt-3 text-dark">
                              <div className="row g-2">
                                <div className="col-8">
                                  <label className="form-label text-dark-50">Title</label>
                                  <input
                                    className="form-control form-control-lg"
                                    value={p.title}
                                    onChange={(e) => updatePromo(p.id, { title: e.target.value })}
                                  />
                                </div>
                                <div className="col-4">
                                  <label className="form-label text-dark-50">Discount %</label>
                                  <input
                                    type="number"
                                    className="form-control"
                                    value={p.discountPct ?? 0}
                                    onChange={(e) => updatePromo(p.id, { discountPct: Number(e.target.value || 0) })}
                                  />
                                </div>
                              </div>
                              <div className="mt-2">
                                <label className="form-label text-dark-50">Subtitle</label>
                                <input
                                  className="form-control"
                                  value={p.subtitle || ''}
                                  onChange={(e) => updatePromo(p.id, { subtitle: e.target.value })}
                                />
                              </div>
                            </div>
                          </div>

                          <div className="card-body">
                            {/* Platos en promo */}
                            <div className="mb-3">
                              <label className="form-label">Dishes in promotion</label>
                              <select
                                multiple
                                className="form-select"
                                value={p.menuItemIds || []}
                                onChange={(e) => {
                                  const values = Array.from(e.target.selectedOptions).map((o) => o.value);
                                  updatePromo(p.id, { menuItemIds: values });
                                }}
                                style={{ minHeight: 120 }}
                              >
                                {menuItems.map((mi) => (
                                  <option key={mi.id} value={mi.id}>{mi.name}</option>
                                ))}
                              </select>
                              <div className="form-text">Seleccione uno o más platos.</div>
                            </div>

                            {/* NUEVO: Elegir imagen de portada desde los platos seleccionados */}
                            {dishes.length > 0 && (
                              <div className="mb-3">
                                <label className="form-label">Cover image (from selected dishes)</label>
                                <select
                                  className="form-select"
                                  value={selectedCoverId}
                                  onChange={(e) => {
                                    const chosen = dishes.find((d) => d.id === e.target.value);
                                    updatePromo(p.id, { imageUrl: chosen?.imageUrl || undefined });
                                  }}
                                >
                                  <option value="">— Select a dish image —</option>
                                  {dishes.map((d) => (
                                    <option key={d.id} value={d.id}>
                                      {d.name}
                                    </option>
                                  ))}
                                </select>
                                <div className="form-text">
                                  Esta imagen se mostrará en el listado público de promociones.
                                </div>

                                {/* preview de la imagen elegida */}
                                {p.imageUrl && (
                                  <div className="mt-2">
                                    <img
                                      src={p.imageUrl}
                                      alt="Promo cover"
                                      style={{ width: '100%', maxHeight: 200, objectFit: 'cover', borderRadius: 8 }}
                                    />
                                  </div>
                                )}
                              </div>
                            )}

                            {/* Preview de platos seleccionados */}
                            {dishes.length > 0 && (
                              <div className="mb-3">
                                <div className="d-flex gap-2 flex-wrap">
                                  {dishes.map((d) => (
                                    <div key={d.id} className="d-flex align-items-center border rounded p-2" style={{ minWidth: 220 }}>
                                      <img
                                        src={d.imageUrl || '/placeholder.png'}
                                        alt={d.name}
                                        width={64}
                                        height={64}
                                        style={{ objectFit: 'cover', borderRadius: 8 }}
                                      />
                                      <div className="ms-2">
                                        <div className="fw-semibold">{d.name}</div>
                                        {typeof d.price === 'number' && (
                                          <div className="text-muted small">Q {d.price.toFixed(2)}</div>
                                        )}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Cupones asociados */}
                            <div className="mb-2">
                              <label className="form-label">Coupons to attach</label>
                              <select
                                multiple
                                className="form-select"
                                value={p.couponIds || []}
                                onChange={(e) => {
                                  const values = Array.from(e.target.selectedOptions).map((o) => o.value);
                                  updatePromo(p.id, { couponIds: values });
                                }}
                                style={{ minHeight: 120 }}
                              >
                                {coupons.map((c) => (
                                  <option key={c.id} value={c.id}>
                                    {(c.label || 'Untitled')} — {c.code}
                                    {typeof c.discountPct === 'number' ? ` (${c.discountPct}%)` : ''}
                                  </option>
                                ))}
                              </select>
                              <div className="form-text">Asocie cupones existentes a esta promoción.</div>
                            </div>

                            <div className="d-flex justify-content-end">
                              <button className="btn btn-outline-danger btn-sm" onClick={() => removePromo(p.id)}>
                                Remove promotion
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* === FEATURED MENU === */}
          {tab === 'featured' && (
            <div className="card shadow-sm">
              <div className="card-body">
                <div className="row g-3">
                  <div className="col-md-6">
                    <label className="form-label">Title</label>
                    <input
                      className="form-control"
                      value={cfg.featuredMenu.title || ''}
                      onChange={(e) =>
                        setCfg((prev) => ({ ...prev, featuredMenu: { ...prev.featuredMenu, title: e.target.value } }))
                      }
                    />
                  </div>

                  {/* Categorías */}
                  <div className="col-12">
                    <label className="form-label">Categories</label>
                    <div className="d-flex flex-wrap gap-2">
                      {categories.map((c) => {
                        const active = cfg.featuredMenu.categoryIds?.includes(c.id);
                        return (
                          <button
                            key={c.id}
                            type="button"
                            className={`btn btn-sm ${active ? 'btn-primary' : 'btn-outline-primary'}`}
                            onClick={() => toggleCategory(c.id)}
                          >
                            {active ? '✓ ' : ''}{c.name}
                          </button>
                        );
                      })}
                    </div>
                    <div className="form-text">Selecciona una o varias categorías.</div>
                  </div>

                  {/* Subcategorías */}
                  <div className="col-12">
                    <label className="form-label">Subcategories</label>
                    <div className="d-flex flex-wrap gap-2">
                      {subcategories.map((s) => {
                        const active = cfg.featuredMenu.subcategoryIds?.includes(s.id);
                        // si se seleccionan categorías, opcional: filtrar subcategorías por esas categorías
                        if (cfg.featuredMenu.categoryIds?.length) {
                          if (s.categoryId && !cfg.featuredMenu.categoryIds.includes(s.categoryId)) return null;
                        }
                        return (
                          <button
                            key={s.id}
                            type="button"
                            className={`btn btn-sm ${active ? 'btn-success' : 'btn-outline-success'}`}
                            onClick={() => toggleSubcategory(s.id)}
                          >
                            {active ? '✓ ' : ''}{s.name}
                          </button>
                        );
                      })}
                    </div>
                    <div className="form-text">Refina por subcategorías (opcional).</div>
                  </div>

                  {/* Items específicos */}
                  <div className="col-12">
                    <label className="form-label">Specific items (optional)</label>
                    <select
                      multiple
                      className="form-select"
                      value={cfg.featuredMenu.itemIds || []}
                      onChange={(e) => {
                        const values = Array.from(e.target.selectedOptions).map((o) => o.value);
                        setCfg((prev) => ({
                          ...prev,
                          featuredMenu: { ...prev.featuredMenu, itemIds: values },
                        }));
                      }}
                      style={{ minHeight: 180 }}
                    >
                      {menuItems
                        .filter((mi) => {
                          // Filtro por categorías/subcats seleccionadas si existen
                          if (cfg.featuredMenu.categoryIds?.length && mi.categoryId) {
                            if (!cfg.featuredMenu.categoryIds.includes(mi.categoryId)) return false;
                          }
                          if (cfg.featuredMenu.subcategoryIds?.length && mi.subcategoryId) {
                            if (!cfg.featuredMenu.subcategoryIds.includes(mi.subcategoryId)) return false;
                          }
                          return true;
                        })
                        .map((mi) => (
                          <option key={mi.id} value={mi.id}>{mi.name}</option>
                        ))}
                    </select>
                    <div className="form-text">
                      Si no eliges items, el frontend puede usar top items de las categorías seleccionadas.
                    </div>
                  </div>

                  {/* Preview items elegidos */}
                  {cfg.featuredMenu.itemIds && cfg.featuredMenu.itemIds.length > 0 && (
                    <div className="col-12">
                      <div className="d-flex flex-wrap gap-2">
                        {cfg.featuredMenu.itemIds.map((id) => {
                          const it = menuItems.find((m) => m.id === id);
                          if (!it) return null;
                          return (
                            <div key={id} className="border rounded p-2 d-flex align-items-center" style={{ minWidth: 220 }}>
                              <img
                                src={it.imageUrl || '/placeholder.png'}
                                alt={it.name}
                                width={64}
                                height={64}
                                style={{ objectFit: 'cover', borderRadius: 8 }}
                              />
                              <div className="ms-2">
                                <div className="fw-semibold">{it.name}</div>
                                {typeof it.price === 'number' && <div className="text-muted small">Q {it.price.toFixed(2)}</div>}
                              </div>
                              <button
                                className="btn sm btn-outline-danger ms-auto"
                                onClick={() => toggleItem(id)}
                                title="Remove"
                              >
                                ×
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <div className="col-12">
                    <div className="alert alert-secondary mb-0">
                      Tip: puedes combinar categorías/subcategorías y, opcionalmente, fijar items exactos.
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* === GALLERY (Carrusel automático en admin) === */}
          {tab === 'gallery' && (
            <div className="card shadow-sm">
              <div className="card-body">
                <div className="d-flex align-items-center gap-2 mb-3">
                  <input ref={galleryInputRef} type="file" accept="image/*" className="form-control" />
                  <button className="btn btn-outline-primary" onClick={handleAddGalleryImage}>
                    Add image (auto-compress)
                  </button>
                </div>

                {(cfg.gallery.images || []).length === 0 && (
                  <div className="text-muted">No images yet.</div>
                )}

                {(cfg.gallery.images || []).length > 0 && (
                  <div className="position-relative">
                    <div className="ratio ratio-21x9 bg-light rounded overflow-hidden">
                      {/* imagen actual */}
                      <img
                        src={cfg.gallery.images[galleryIdx]?.url}
                        alt={cfg.gallery.images[galleryIdx]?.alt || 'Gallery'}
                        style={{ objectFit: 'cover', width: '100%', height: '100%' }}
                      />
                    </div>

                    {/* indicadores */}
                    <div className="d-flex justify-content-center mt-2">
                      {(cfg.gallery.images || []).map((_, i) => (
                        <button
                          key={i}
                          className={`btn btn-sm mx-1 ${i === galleryIdx ? 'btn-primary' : 'btn-outline-primary'}`}
                          style={{ width: 10, height: 10, borderRadius: '50%', padding: 0 }}
                          onClick={() => setGalleryIdx(i)}
                          aria-label={`Go to slide ${i + 1}`}
                        />
                      ))}
                    </div>

                    {/* edición de alt */}
                    <div className="row g-3 mt-3">
                      {(cfg.gallery.images || []).map((g, idx) => (
                        <div className="col-12 col-md-6" key={idx}>
                          <div className="card h-100">
                            <div className="row g-0">
                              <div className="col-4">
                                <img
                                  src={g.url}
                                  className="img-fluid rounded-start"
                                  alt={g.alt || 'Gallery'}
                                  style={{ objectFit: 'cover', height: '100%' }}
                                />
                              </div>
                              <div className="col-8">
                                <div className="card-body">
                                  <label className="form-label">Alt text</label>
                                  <input
                                    className="form-control"
                                    placeholder="Alt text"
                                    value={g.alt || ''}
                                    onChange={(e) => {
                                      setCfg((prev) => {
                                        const images = [...prev.gallery.images];
                                        images[idx] = { ...images[idx], alt: e.target.value };
                                        return { ...prev, gallery: { images } };
                                      });
                                    }}
                                  />
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* === ABOUT US (NUEVO) === */}
          {tab === 'about' && (
            <div className="card shadow-sm">
              <div className="card-body">
                <div className="row g-4">
                  <div className="col-md-6">
                    <label className="form-label">Title</label>
                    <input
                      className="form-control"
                      placeholder="About us"
                      value={cfg.aboutUs?.title || ''}
                      onChange={(e) =>
                        setCfg((prev) => ({ ...prev, aboutUs: { ...(prev.aboutUs || {}), title: e.target.value } }))
                      }
                    />
                  </div>

                  <div className="col-12">
                    <label className="form-label">Text</label>
                    <textarea
                      className="form-control"
                      rows={6}
                      placeholder="Tell your story, mission, values…"
                      value={cfg.aboutUs?.text || ''}
                      onChange={(e) =>
                        setCfg((prev) => ({ ...prev, aboutUs: { ...(prev.aboutUs || {}), text: e.target.value } }))
                      }
                    />
                  </div>

                  <div className="col-md-6">
                    <label className="form-label">Image</label>
                    <div className="d-flex gap-2">
                      <input ref={aboutImageInputRef} type="file" accept="image/*" className="form-control" />
                      <button className="btn btn-outline-primary" onClick={handleUploadAboutImage}>
                        Upload
                      </button>
                      {cfg.aboutUs?.imageUrl && (
                        <button
                          className="btn btn-outline-danger"
                          onClick={() => setCfg((prev) => ({ ...prev, aboutUs: { ...(prev.aboutUs || {}), imageUrl: '' } }))}
                        >
                          Remove
                        </button>
                      )}
                    </div>
                    <div className="form-text">Se recomienda 1600×1200 aprox. (se comprime automáticamente).</div>
                  </div>

                  {cfg.aboutUs?.imageUrl && (
                    <div className="col-md-6">
                      <div className="ratio ratio-16x9 rounded overflow-hidden border">
                        <img
                          src={cfg.aboutUs.imageUrl}
                          alt="About cover"
                          style={{ objectFit: 'cover', width: '100%', height: '100%' }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* === SEO === */}
          {tab === 'seo' && (
            <div className="card shadow-sm">
              <div className="card-body">
                <div className="row g-3">
                  <div className="col-md-6">
                    <label className="form-label">SEO Title</label>
                    <input
                      className="form-control"
                      value={cfg.seo?.title || ''}
                      onChange={(e) =>
                        setCfg((prev) => ({ ...prev, seo: { ...(prev.seo || {}), title: e.target.value } }))
                      }
                    />
                  </div>
                  <div className="col-md-6">
                    <label className="form-label">OG Image URL</label>
                    <input
                      className="form-control"
                      value={cfg.seo?.ogImage || ''}
                      onChange={(e) =>
                        setCfg((prev) => ({ ...prev, seo: { ...(prev.seo || {}), ogImage: e.target.value } }))
                      }
                    />
                  </div>
                  <div className="col-12">
                    <label className="form-label">Description</label>
                    <textarea
                      className="form-control"
                      rows={3}
                      value={cfg.seo?.description || ''}
                      onChange={(e) =>
                        setCfg((prev) => ({ ...prev, seo: { ...(prev.seo || {}), description: e.target.value } }))
                      }
                    />
                  </div>
                  <div className="col-12">
                    <label className="form-label">Keywords (comma separated)</label>
                    <input
                      className="form-control"
                      value={(cfg.seo?.keywords || []).join(', ')}
                      onChange={(e) =>
                        setCfg((prev) => ({
                          ...prev,
                          seo: {
                            ...(prev.seo || {}),
                            keywords: e.target.value
                              .split(',')
                              .map((s) => s.trim())
                              .filter(Boolean),
                          },
                        }))
                      }
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* === PUBLISH === */}
          {tab === 'publish' && (
            <div className="card shadow-sm">
              <div className="card-body">
                <div className="d-flex justify-content-between align-items-start">
                  <div>
                    <div className="fw-semibold">Current status: {cfg.publish?.status || 'draft'}</div>
                    <div className="text-muted">Version: {cfg.publish?.version ?? 0}</div>
                    <div className="small text-muted mt-2">
                      <strong>¿Qué hace Publish?</strong> <br />
                      <span>
                        <em>Save draft</em> guarda la configuración como <code>draft</code> (no afecta la página pública).
                        <br />
                        <em>Publish</em> incrementa la versión y marca como <code>published</code>.
                        La home pública (<code>/</code>) debe leer la versión publicada.
                      </span>
                    </div>
                  </div>
                  <div className="d-flex gap-2">
                    <button className="btn btn-outline-secondary" disabled={saving} onClick={saveDraft}>
                      Save draft
                    </button>
                    <button className="btn btn-primary" disabled={saving} onClick={publishNow}>
                      Publish
                    </button>
                  </div>
                </div>
                <hr />
                <div className="small text-muted">
                  Al publicar, la home pública usará esta configuración marcada como <em>published</em>.
                </div>
              </div>
            </div>
          )}
        </div>
      </OnlyAdmin>
    </Protected>
  );
}
