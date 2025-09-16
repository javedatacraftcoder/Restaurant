/* src/app/admin/taxes/page.tsx */
'use client';

import { useEffect, useMemo, useState } from 'react';
import Protected from '@/components/Protected';
import AdminOnly from '@/components/AdminOnly';
import '@/lib/firebase/client';
import {
  getActiveTaxProfile,
  type TaxProfile,
  type TaxRateRule,
  type OrderType,
  type JurisdictionRule,
} from '@/lib/tax/profile';
import {
  getFirestore,
  collection,
  getDocs,
  doc,
  getDoc,
  deleteDoc,
  setDoc,
} from 'firebase/firestore';

type RoundingMode = 'half_up' | 'half_even';
const ORDER_TYPES: OrderType[] = ['dine-in', 'delivery', 'pickup'];

function csvToArray(s?: string) {
  return (s || '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}
function arrayToCsv(arr?: string[]) {
  return (arr || []).join(', ');
}

/** 🔧 Limpia recursivamente: quita `undefined` y compacta arrays/objetos */
function deepStripUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    // Limpia cada item y elimina los que queden como `undefined`
    const arr = value
      .map((v) => deepStripUndefined(v))
      .filter((v) => v !== undefined) as any[];
    return arr as any;
  }
  if (value !== null && typeof value === 'object') {
    const out: any = {};
    for (const [k, v] of Object.entries(value as any)) {
      if (v === undefined) continue;
      const cleaned = deepStripUndefined(v as any);
      if (cleaned !== undefined) out[k] = cleaned;
    }
    return out;
  }
  // Primitivos (string/number/boolean/null) se devuelven tal cual
  return value;
}

/** Normaliza el perfil para Firestore: quita `id`, aplica limpieza y setea `active: true` */
function normalizeProfileForFirestore(form: TaxProfile) {
  const {
    id: _drop, // no guardar el id dentro del doc
    ...rest
  } = form as any;

  const cleaned = deepStripUndefined({
    ...rest,
    active: true, // para que el listado lo muestre como activo
  });
  return cleaned;
}

export default function AdminTaxesPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Editor state (perfil en edición)
  const [form, setForm] = useState<TaxProfile>({
    country: 'GT',
    currency: 'USD',
    pricesIncludeTax: true,
    rounding: 'half_up',
    rates: [{ code: 'std', label: 'Standard VAT', rateBps: 1200, appliesTo: 'all' }],
    surcharges: [{ code: 'service', label: 'Service charge', percentBps: 0, taxable: false }],
    delivery: { mode: 'out_of_scope', taxable: false },
  });

  // Lista de perfiles en la colección
  const [profiles, setProfiles] = useState<
    Array<{ id: string; data: any; active?: boolean }>
  >([]);

  // Cargar perfil activo + lista de perfiles
  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [active, list] = await Promise.all([
          getActiveTaxProfile(),
          fetchProfilesList(),
        ]);
        if (active) {
          setForm((prev) => ({
            ...prev,
            ...active,
            rates: Array.isArray(active.rates) && active.rates.length
              ? active.rates
              : [{ code: 'std', label: 'Standard VAT', rateBps: 1200, appliesTo: 'all' }],
            surcharges: Array.isArray(active.surcharges) && active.surcharges.length
              ? active.surcharges
              : [{ code: 'service', label: 'Service charge', percentBps: 0, taxable: false }],
            delivery: active.delivery ?? { mode: 'out_of_scope', taxable: false },
          }));
        }
        setProfiles(list);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function fetchProfilesList() {
    const db = getFirestore();
    const snap = await getDocs(collection(db, 'taxProfiles'));
    // active primero
    const rows = snap.docs.map((d) => ({
      id: d.id,
      data: d.data(),
      active: !!(d.data() as any)?.active,
    }));
    return rows.sort((a, b) => (a.active === b.active ? 0 : a.active ? -1 : 1));
  }

  // Cargar un perfil por id dentro del editor
  async function loadProfileIntoEditor(id: string) {
    try {
      const db = getFirestore();
      const snap = await getDoc(doc(db, 'taxProfiles', id));
      if (!snap.exists()) return alert('Profile not found.');
      const raw: any = snap.data();

      // Mapear a TaxProfile (similar a getActiveTaxProfile)
      const toRates = Array.isArray(raw.rates)
        ? raw.rates.map((r: any) => ({
            code: String(r.code),
            label: r.label ? String(r.label) : undefined,
            rateBps: Number(r.rateBps || 0),
            appliesTo: r.appliesTo === 'all' ? 'all' : undefined,
            itemCategoryIn: Array.isArray(r.itemCategoryIn) ? r.itemCategoryIn.map(String) : undefined,
            itemTagIn: Array.isArray(r.itemTagIn) ? r.itemTagIn.map(String) : undefined,
            excludeItemTagIn: Array.isArray(r.excludeItemTagIn) ? r.excludeItemTagIn.map(String) : undefined,
            orderTypeIn: Array.isArray(r.orderTypeIn) ? (r.orderTypeIn as OrderType[]) : undefined,
          }))
        : [];

      const toSurch = Array.isArray(raw.surcharges)
        ? raw.surcharges.map((s: any) => ({
            code: String(s.code),
            label: s.label ? String(s.label) : undefined,
            percentBps: Number(s.percentBps || 0),
            applyWhenOrderTypeIn: Array.isArray(s.applyWhenOrderTypeIn) ? (s.applyWhenOrderTypeIn as OrderType[]) : undefined,
            taxable: Boolean(s.taxable ?? false),
            taxCode: s.taxCode ? String(s.taxCode) : undefined,
          }))
        : [];

      const profile: TaxProfile = {
        id: snap.id,
        country: String(raw.country || 'GT'),
        currency: String(raw.currency || 'USD'),
        pricesIncludeTax: Boolean(raw.pricesIncludeTax ?? true),
        rounding: raw.rounding === 'half_even' ? 'half_even' : 'half_up',
        rates: toRates.length ? toRates : [{ code: 'std', label: 'Standard VAT', rateBps: 1200, appliesTo: 'all' }],
        surcharges: toSurch.length ? toSurch : [{ code: 'service', label: 'Service charge', percentBps: 0, taxable: false }],
        delivery: raw.delivery
          ? {
              mode: raw.delivery.mode === 'as_line' ? 'as_line' : 'out_of_scope',
              taxable: Boolean(raw.delivery.taxable ?? false),
              taxCode: raw.delivery.taxCode ? String(raw.delivery.taxCode) : undefined,
            }
          : { mode: 'out_of_scope', taxable: false },
        jurisdictions: Array.isArray(raw.jurisdictions) ? raw.jurisdictions : undefined,
        b2bConfig: raw.b2bConfig || undefined,
      };
      setForm(profile);
      alert(`Loaded profile "${snap.id}" into editor. Remember to Save to set it active.`);
    } catch (e: any) {
      alert(e?.message || 'Could not load profile.');
    }
  }

  // Marcar como ACTIVO copiando el doc seleccionado a taxProfiles/active
  async function setActiveProfile(id: string) {
    try {
      const db = getFirestore();
      const snap = await getDoc(doc(db, 'taxProfiles', id));
      if (!snap.exists()) return alert('Profile not found.');
      const raw = snap.data() as any;

      const payload = normalizeProfileForFirestore({
        ...(raw as TaxProfile),
        // aseguramos defaults mínimos
        country: String((raw as any).country || 'GT'),
        currency: String((raw as any).currency || 'USD'),
        pricesIncludeTax: Boolean((raw as any).pricesIncludeTax ?? true),
        rounding: (raw as any).rounding === 'half_even' ? 'half_even' : 'half_up',
      } as TaxProfile);

      const dbRef = doc(getFirestore(), 'taxProfiles', 'active');
      await setDoc(dbRef, payload, { merge: false });

      // refrescar listado + editor (cargamos el activo)
      const [active, list] = await Promise.all([getActiveTaxProfile(), fetchProfilesList()]);
      if (active) setForm(active);
      setProfiles(list);
      alert(`"${id}" is now active.`);
    } catch (e: any) {
      alert(e?.message || 'Could not set active.');
    }
  }

  // Borrar (bloquea si es activo)
  async function removeProfile(id: string, isActive?: boolean) {
    if (isActive) {
      return alert('You cannot delete the active profile. Set another profile active first.');
    }
    const ok = confirm(`Delete profile "${id}"? This cannot be undone.`);
    if (!ok) return;
    try {
      const db = getFirestore();
      await deleteDoc(doc(db, 'taxProfiles', id));
      setProfiles(await fetchProfilesList());
      alert('Profile deleted.');
    } catch (e: any) {
      alert(e?.message || 'Could not delete.');
    }
  }

  const onChange = <K extends keyof TaxProfile>(key: K, value: TaxProfile[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  // Helpers de Service Charge (usamos el primer surcharge)
  const service = form.surcharges?.[0];
  const setService = (patch: Partial<NonNullable<TaxProfile['surcharges']>[number]>) => {
    const next = [...(form.surcharges || [])];
    if (!next[0]) next[0] = { code: 'service', label: 'Service charge', percentBps: 0, taxable: false };
    next[0] = { ...next[0], ...patch };
    onChange('surcharges', next);
  };

  // ➕ Helper para B2B
  const setB2B = (patch: any) => {
    onChange('b2bConfig', { ...(form.b2bConfig || {}), ...patch });
  };

  // Guardar editor → escribir doc activo limpio (sin undefined)
  const save = async () => {
    setSaving(true);
    try {
      const payload = normalizeProfileForFirestore({
        ...form,
        country: String(form.country || 'GT'),
        currency: String(form.currency || 'USD'),
        pricesIncludeTax: !!form.pricesIncludeTax,
        rounding: (form.rounding === 'half_even' ? 'half_even' : 'half_up'),
      } as TaxProfile);

      const db = getFirestore();
      await setDoc(doc(db, 'taxProfiles', 'active'), payload, { merge: false });

      setProfiles(await fetchProfilesList());
      alert('Tax profile saved (and set active).');
    } catch (e: any) {
      alert(e?.message || 'Could not save.');
    } finally {
      setSaving(false);
    }
  };

  const rateCodes = useMemo(() => (form.rates || []).map((r) => r.code), [form.rates]);

  if (loading) {
    return (
      <Protected>
        <AdminOnly>
          <main className="container py-4">
            <h1>Taxes</h1>
            <p>Loading…</p>
          </main>
        </AdminOnly>
      </Protected>
    );
  }

  return (
    <Protected>
      <AdminOnly>
        <main className="container py-4">
          <div className="d-flex align-items-center justify-content-between mb-3">
            <h1 className="h3 m-0">Taxes</h1>
            <button disabled={saving} className="btn btn-primary" onClick={save}>
              {saving ? 'Saving…' : 'Save profile'}
            </button>
          </div>

          <div className="row g-3">
            {/* Columna principal */}
            <div className="col-12 col-lg-8">
              {/* Básicos */}
              <div className="card shadow-sm mb-3">
                <div className="card-header"><strong>Basic settings</strong></div>
                <div className="card-body">
                  <div className="row">
                    <div className="col-md-3 mb-3">
                      <label className="form-label">Country</label>
                      <input
                        className="form-control"
                        value={form.country || ''}
                        onChange={(e) => onChange('country', e.target.value)}
                      />
                    </div>
                    <div className="col-md-3 mb-3">
                      <label className="form-label">Currency</label>
                      <input
                        className="form-control"
                        value={form.currency || ''}
                        onChange={(e) => onChange('currency', e.target.value)}
                      />
                    </div>
                    <div className="col-md-3 mb-3">
                      <label className="form-label">Prices include tax?</label>
                      <div className="form-check form-switch">
                        <input
                          type="checkbox"
                          className="form-check-input"
                          checked={!!form.pricesIncludeTax}
                          onChange={(e) => onChange('pricesIncludeTax', e.target.checked)}
                        />
                      </div>
                      <div className="form-text">Inclusive: el IVA ya está dentro del precio.</div>
                    </div>
                    <div className="col-md-3 mb-3">
                      <label className="form-label">Rounding</label>
                      <select
                        className="form-select"
                        value={(form.rounding || 'half_up') as RoundingMode}
                        onChange={(e) => onChange('rounding', e.target.value as RoundingMode)}
                      >
                        <option value="half_up">Half up (5→arriba)</option>
                        <option value="half_even">Half even (banco)</option>
                      </select>
                    </div>
                  </div>
                </div>
              </div>

              {/* Editor de tasas */}
              <RatesEditor
                rates={form.rates || []}
                onChange={(next) => onChange('rates', next)}
                pricesIncludeTax={!!form.pricesIncludeTax}
              />

              {/* Service charge */}
              <div className="card shadow-sm mb-3">
                <div className="card-header"><strong>Service charge</strong></div>
                <div className="card-body">
                  <div className="row">
                    <div className="col-md-4 mb-3">
                      <label className="form-label">Enabled</label>
                      <div className="form-check form-switch">
                        <input
                          className="form-check-input"
                          type="checkbox"
                          checked={!!(service && service.percentBps && service.percentBps > 0)}
                          onChange={(e) => {
                            const enabled = e.target.checked;
                            setService({ percentBps: enabled ? (service?.percentBps || 1000) : 0 });
                          }}
                        />
                      </div>
                    </div>
                    <div className="col-md-4 mb-3">
                      <label className="form-label">Rate (%)</label>
                      <div className="input-group">
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          className="form-control"
                          value={((service?.percentBps || 0) / 100).toString()}
                          onChange={(e) => setService({ percentBps: Math.round(parseFloat(e.target.value || '0') * 100) })}
                        />
                        <span className="input-group-text">%</span>
                      </div>
                    </div>
                    <div className="col-md-4 mb-3">
                      <label className="form-label">Taxable?</label>
                      <div className="form-check form-switch">
                        <input
                          className="form-check-input"
                          type="checkbox"
                          checked={!!service?.taxable}
                          onChange={(e) => setService({ taxable: e.target.checked })}
                        />
                      </div>
                      {service?.taxable && (
                        <div className="mt-2">
                          <label className="form-label">Tax code</label>
                          <select
                            className="form-select"
                            value={service?.taxCode || ''}
                            onChange={(e) => setService({ taxCode: e.target.value || undefined })}
                          >
                            <option value="">(choose)</option>
                            {(form.rates || []).map((r) => (
                              <option key={r.code} value={r.code}>{r.code}</option>
                            ))}
                          </select>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="form-text">
                    Si es “Taxable”, se calculará IVA al cargo usando el <i>Tax code</i> elegido.
                  </div>
                </div>
              </div>

              {/* Delivery policy */}
              <div className="card shadow-sm mb-3">
                <div className="card-header"><strong>Delivery fee policy</strong></div>
                <div className="card-body">
                  <div className="row">
                    <div className="col-md-4 mb-3">
                      <label className="form-label">Mode</label>
                      <select
                        className="form-select"
                        value={form.delivery?.mode || 'out_of_scope'}
                        onChange={(e) =>
                          onChange('delivery', {
                            ...(form.delivery || { mode: 'out_of_scope' }),
                            mode: e.target.value as 'as_line' | 'out_of_scope',
                          })
                        }
                      >
                        <option value="out_of_scope">Out of scope (fuera del motor)</option>
                        <option value="as_line">As line (línea sintética)</option>
                      </select>
                    </div>
                    <div className="col-md-4 mb-3">
                      <label className="form-label">Taxable?</label>
                      <div className="form-check form-switch">
                        <input
                          className="form-check-input"
                          type="checkbox"
                          checked={!!form.delivery?.taxable}
                          onChange={(e) =>
                            onChange('delivery', {
                              ...(form.delivery || { mode: 'out_of_scope' }),
                              taxable: e.target.checked,
                            })
                          }
                        />
                      </div>
                    </div>
                    <div className="col-md-4 mb-3">
                      <label className="form-label">Tax code (if taxable)</label>
                      <select
                        className="form-select"
                        value={form.delivery?.taxCode || ''}
                        onChange={(e) =>
                          onChange('delivery', {
                            ...(form.delivery || { mode: 'out_of_scope' }),
                            taxCode: e.target.value || undefined,
                          })
                        }
                        disabled={!form.delivery?.taxable}
                      >
                        <option value="">(choose)</option>
                        {(form.rates || []).map((r) => (
                          <option key={r.code} value={r.code}>{r.code}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="form-text">
                    Con “As line”, el engine agrega una línea “delivery” y, si es taxable, aplica el código elegido.
                  </div>
                </div>
              </div>

              {/* Jurisdictions (read-only quick view) */}
              <div className="card shadow-sm mb-3">
                <div className="card-header"><strong>Jurisdictions (read-only quick view)</strong></div>
                <div className="card-body">
                  {Array.isArray(form.jurisdictions) && form.jurisdictions.length > 0 ? (
                    <div className="d-flex flex-column gap-2">
                      {form.jurisdictions.map((j: any, i: number) => {
                        const m = j?.match || {};
                        const tags: string[] = [];
                        if (m.country) tags.push(`country=${m.country}`);
                        if ((m as any).state) tags.push(`state=${(m as any).state}`);
                        if (m.city) tags.push(`city=${m.city}`);
                        if (m.zipPrefix) tags.push(`zip^=${m.zipPrefix}`);
                        const counts: string[] = [];
                        if (Array.isArray(j.ratesOverride)) counts.push(`rates: ${j.ratesOverride.length}`);
                        if (Array.isArray(j.surchargesOverride)) counts.push(`surcharges: ${j.surchargesOverride.length}`);
                        if (j.deliveryOverride) counts.push(`delivery: 1`);
                        return (
                          <div className="border rounded p-2" key={i}>
                            <div className="d-flex justify-content-between">
                              <div><strong>{j.code || `jur-${i+1}`}</strong></div>
                              <div className="text-muted small">{counts.join(' · ') || 'no overrides'}</div>
                            </div>
                            <div className="text-muted small">match: {tags.join(', ') || '—'}</div>
                            {j.pricesIncludeTaxOverride !== undefined && (
                              <div className="text-muted small">pricesIncludeTax: {String(j.pricesIncludeTaxOverride)}</div>
                            )}
                            {j.roundingOverride && (
                              <div className="text-muted small">rounding: {j.roundingOverride}</div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="text-muted">
                      <div>No jurisdiction overrides configured.</div>
                      <div className="small">
                        (Edición avanzada pendiente: puedes cargar/editar estos documentos en <code>taxProfiles/*</code> desde Firestore o ampliamos este panel más adelante.)
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Jurisdictions (editor) */}
              <JurisdictionsEditor
                jurisdictions={form.jurisdictions || []}
                onChange={(next) => onChange('jurisdictions', next)}
                rateCodes={rateCodes}
              />

              {/* B2B / Invoice numbering */}
              <div className="card shadow-sm mb-3">
                <div className="card-header"><strong>B2B / Invoice numbering</strong></div>
                <div className="card-body">
                  <div className="row">
                    <div className="col-md-6 mb-3">
                      <label className="form-label">Tax-exempt with Tax ID?</label>
                      <div className="form-check form-switch">
                        <input
                          className="form-check-input"
                          type="checkbox"
                          checked={!!form.b2bConfig?.taxExemptWithTaxId}
                          onChange={(e) => setB2B({ taxExemptWithTaxId: e.target.checked })}
                        />
                      </div>
                      <div className="form-text">Si está activo, un cliente con NIT marca la orden como exenta.</div>
                    </div>
                    <div className="col-md-6 mb-3">
                      <label className="form-label">Invoice numbering enabled</label>
                      <div className="form-check form-switch">
                        <input
                          className="form-check-input"
                          type="checkbox"
                          checked={!!form.b2bConfig?.invoiceNumbering?.enabled}
                          onChange={(e) =>
                            setB2B({
                              invoiceNumbering: {
                                ...(form.b2bConfig?.invoiceNumbering || {}),
                                enabled: e.target.checked,
                              },
                            })
                          }
                        />
                      </div>
                    </div>
                  </div>

                  {form.b2bConfig?.invoiceNumbering?.enabled && (
                    <div className="row">
                      <div className="col-md-3 mb-3">
                        <label className="form-label">Series</label>
                        <input
                          className="form-control"
                          value={form.b2bConfig?.invoiceNumbering?.series || ''}
                          onChange={(e) =>
                            setB2B({
                              invoiceNumbering: {
                                ...(form.b2bConfig?.invoiceNumbering || { enabled: true }),
                                series: e.target.value || undefined,
                              },
                            })
                          }
                        />
                      </div>
                      <div className="col-md-3 mb-3">
                        <label className="form-label">Prefix</label>
                        <input
                          className="form-control"
                          value={form.b2bConfig?.invoiceNumbering?.prefix || ''}
                          onChange={(e) =>
                            setB2B({
                              invoiceNumbering: {
                                ...(form.b2bConfig?.invoiceNumbering || { enabled: true }),
                                prefix: e.target.value || undefined,
                              },
                            })
                          }
                        />
                      </div>
                      <div className="col-md-3 mb-3">
                        <label className="form-label">Suffix</label>
                        <input
                          className="form-control"
                          value={form.b2bConfig?.invoiceNumbering?.suffix || ''}
                          onChange={(e) =>
                            setB2B({
                              invoiceNumbering: {
                                ...(form.b2bConfig?.invoiceNumbering || { enabled: true }),
                                suffix: e.target.value || undefined,
                              },
                            })
                          }
                        />
                      </div>
                      <div className="col-md-3 mb-3">
                        <label className="form-label">Padding</label>
                        <input
                          type="number"
                          min={0}
                          className="form-control"
                          value={String(form.b2bConfig?.invoiceNumbering?.padding ?? '')}
                          onChange={(e) =>
                            setB2B({
                              invoiceNumbering: {
                                ...(form.b2bConfig?.invoiceNumbering || { enabled: true }),
                                padding: e.target.value ? Math.max(0, parseInt(e.target.value)) : undefined,
                              },
                            })
                          }
                        />
                      </div>
                      <div className="col-md-6 mb-3">
                        <label className="form-label">Reset policy</label>
                        <select
                          className="form-select"
                          value={form.b2bConfig?.invoiceNumbering?.resetPolicy || 'never'}
                          onChange={(e) =>
                            setB2B({
                              invoiceNumbering: {
                                ...(form.b2bConfig?.invoiceNumbering || { enabled: true }),
                                resetPolicy: e.target.value as any,
                              },
                            })
                          }
                        >
                          <option value="never">never</option>
                          <option value="yearly">yearly</option>
                          <option value="monthly">monthly</option>
                          <option value="daily">daily</option>
                        </select>
                      </div>
                    </div>
                  )}
                  <div className="form-text">
                    Para emitir, tu backend debe implementar <code>POST /api/invoices/issue</code> (ya lo usa Caja).
                  </div>
                </div>
              </div>

              {/* Nota Fase C */}
              <div className="card shadow-sm">
                <div className="card-body">
                  <div className="small text-muted">
                    Fase C lista: múltiples tasas, delivery opcionalmente gravable, jurisdicción por dirección,
                    exento/zero-rated, B2B con numeración opcional.
                  </div>
                </div>
              </div>
            </div>

            {/* Columna lateral */}
            <div className="col-12 col-lg-4">
              {/* Inline test */}
              <div className="card shadow-sm mb-3">
                <div className="card-header"><strong>Inline test</strong></div>
                <div className="card-body">
                  <InlineTest profile={form} />
                </div>
              </div>

              {/* Existing profiles (manage) */}
              <div className="card shadow-sm">
                <div className="card-header"><strong>Existing profiles</strong></div>
                <div className="card-body">
                  {profiles.length === 0 ? (
                    <div className="text-muted small">No profiles found.</div>
                  ) : (
                    <div className="d-flex flex-column gap-2">
                      {profiles.map((p) => {
                        const d: any = p.data || {};
                        return (
                          <div key={p.id} className="border rounded p-2">
                            <div className="d-flex justify-content-between align-items-start">
                              <div className="me-2">
                                <div className="fw-semibold">
                                  {p.id}{' '}
                                  {p.active && <span className="badge bg-success">active</span>}
                                </div>
                                <div className="small text-muted">
                                  {String(d.country || 'GT')} · {String(d.currency || 'USD')} ·{' '}
                                  inclTax={String(!!d.pricesIncludeTax)} · rates={Array.isArray(d.rates) ? d.rates.length : 0}
                                </div>
                              </div>
                              <div className="btn-group btn-group-sm">
                                <button className="btn btn-outline-primary" onClick={() => loadProfileIntoEditor(p.id)}>
                                  Load
                                </button>
                                <button
                                  className="btn btn-outline-success"
                                  onClick={() => setActiveProfile(p.id)}
                                  disabled={p.active}
                                  title="Set this profile active now"
                                >
                                  Set active
                                </button>
                                <button
                                  className="btn btn-outline-danger"
                                  onClick={() => removeProfile(p.id, p.active)}
                                  disabled={p.active}
                                >
                                  Delete
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <div className="small text-muted mt-2">
                    Usa “Load” para editarlo aquí y “Save profile” para activarlo. “Set active” lo activa tal cual está guardado.
                  </div>
                </div>
              </div>
            </div>
          </div>
        </main>
      </AdminOnly>
    </Protected>
  );
}

/* ====================== Rates Editor ====================== */
function RatesEditor({
  rates,
  onChange,
  pricesIncludeTax,
}: {
  rates: TaxRateRule[];
  onChange: (next: TaxRateRule[]) => void;
  pricesIncludeTax: boolean;
}) {
  const addRate = () => {
    const suffix = rates.length + 1;
    onChange([
      ...rates,
      {
        code: `rate_${suffix}`,
        label: '',
        rateBps: 0,
      },
    ]);
  };
  const removeRate = (idx: number) => {
    const next = rates.slice();
    next.splice(idx, 1);
    onChange(next);
  };
  const update = (idx: number, patch: Partial<TaxRateRule>) => {
    const next = rates.slice();
    next[idx] = { ...next[idx], ...patch };
    onChange(next);
  };

  return (
    <div className="card shadow-sm mb-3">
      <div className="card-header d-flex align-items-center justify-content-between">
        <strong>Tax rates</strong>
        <button className="btn btn-sm btn-outline-primary" onClick={addRate}>Add rate</button>
      </div>
      <div className="card-body">
        {rates.length === 0 && <div className="text-muted small">No rates yet.</div>}

        {rates.map((r, idx) => (
          <div className="border rounded p-2 mb-3" key={idx}>
            <div className="d-flex justify-content-between align-items-start">
              <div className="w-100">
                <div className="row">
                  <div className="col-md-3 mb-2">
                    <label className="form-label">Code</label>
                    <input
                      className="form-control"
                      value={r.code || ''}
                      onChange={(e) => update(idx, { code: e.target.value.trim() })}
                    />
                  </div>
                  <div className="col-md-3 mb-2">
                    <label className="form-label">Label</label>
                    <input
                      className="form-control"
                      value={r.label || ''}
                      onChange={(e) => update(idx, { label: e.target.value })}
                    />
                  </div>
                  <div className="col-md-3 mb-2">
                    <label className="form-label">Rate (%)</label>
                    <div className="input-group">
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        className="form-control"
                        value={((r.rateBps || 0) / 100).toString()}
                        onChange={(e) =>
                          update(idx, { rateBps: Math.round(parseFloat(e.target.value || '0') * 100) })
                        }
                      />
                      <span className="input-group-text">%</span>
                    </div>
                    <div className="form-text">
                      {pricesIncludeTax ? 'Inclusive' : 'Exclusive'} · 12.00% → 1200 bps
                    </div>
                  </div>
                  <div className="col-md-3 mb-2">
                    <label className="form-label">Applies to</label>
                    <select
                      className="form-select"
                      value={r.appliesTo === 'all' ? 'all' : 'filtered'}
                      onChange={(e) => update(idx, { appliesTo: e.target.value === 'all' ? 'all' : undefined })}
                    >
                      <option value="filtered">Filtered</option>
                      <option value="all">All items</option>
                    </select>
                    <div className="form-text">Si “All items”, se ignoran filtros.</div>
                  </div>
                </div>

                {r.appliesTo !== 'all' && (
                  <div className="mt-2">
                    <div className="row">
                      <div className="col-md-4 mb-2">
                        <label className="form-label">Categories (CSV)</label>
                        <input
                          className="form-control"
                          placeholder="ej. food, beverage"
                          value={arrayToCsv(r.itemCategoryIn)}
                          onChange={(e) => update(idx, { itemCategoryIn: csvToArray(e.target.value) })}
                        />
                      </div>
                      <div className="col-md-4 mb-2">
                        <label className="form-label">Tags include (CSV)</label>
                        <input
                          className="form-control"
                          placeholder="ej. gluten_free, promo"
                          value={arrayToCsv(r.itemTagIn)}
                          onChange={(e) => update(idx, { itemTagIn: csvToArray(e.target.value) })}
                        />
                      </div>
                      <div className="col-md-4 mb-2">
                        <label className="form-label">Tags exclude (CSV)</label>
                        <input
                          className="form-control"
                          placeholder="ej. non_taxable"
                          value={arrayToCsv(r.excludeItemTagIn)}
                          onChange={(e) => update(idx, { excludeItemTagIn: csvToArray(e.target.value) })}
                        />
                      </div>
                    </div>

                    <div className="mt-2">
                      <label className="form-label">Order types</label>
                      <div className="d-flex flex-wrap gap-3">
                        {ORDER_TYPES.map((ot) => {
                          const set = new Set(r.orderTypeIn || []);
                          const checked = set.has(ot);
                          return (
                            <label key={ot} className="d-flex align-items-center gap-2">
                              <input
                                type="checkbox"
                                className="form-check-input"
                                checked={checked}
                                onChange={(e) => {
                                  const next = new Set(r.orderTypeIn || []);
                                  if (e.target.checked) next.add(ot);
                                  else next.delete(ot);
                                  update(idx, { orderTypeIn: Array.from(next) as OrderType[] });
                                }}
                              />
                              <span>{ot}</span>
                            </label>
                          );
                        })}
                      </div>
                      <div className="form-text">Si está vacío, aplica a todos los tipos.</div>
                    </div>
                  </div>
                )}
              </div>

              <div className="ms-2">
                <button
                  className="btn btn-outline-danger btn-sm"
                  onClick={() => removeRate(idx)}
                  title="Remove rate"
                >
                  Remove
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ====================== Jurisdictions Editor ====================== */
function JurisdictionsEditor({
  jurisdictions,
  onChange,
  rateCodes,
}: {
  jurisdictions: JurisdictionRule[];
  onChange: (next: JurisdictionRule[]) => void;
  rateCodes: string[];
}) {
  const addJur = () => {
    onChange([
      ...jurisdictions,
      {
        code: `jur_${jurisdictions.length + 1}`,
        match: {},
      } as JurisdictionRule,
    ]);
  };
  const removeJur = (idx: number) => {
    const next = jurisdictions.slice();
    next.splice(idx, 1);
    onChange(next);
  };
  const updateJur = (idx: number, patch: Partial<JurisdictionRule>) => {
    const next = jurisdictions.slice();
    next[idx] = { ...next[idx], ...patch };
    onChange(next);
  };

  const updateMatch = (idx: number, key: 'country' | 'state' | 'city' | 'zipPrefix', value?: string) => {
    const j = jurisdictions[idx] || ({} as any);
    updateJur(idx, { match: { ...(j.match || {}), [key]: value || undefined } as any });
  };

  const setRates = (idx: number, rates: TaxRateRule[]) => {
    updateJur(idx, { ratesOverride: rates });
  };

  const setDelivery = (idx: number, patch: any) => {
    const cur = jurisdictions[idx]?.deliveryOverride || { mode: 'out_of_scope' };
    updateJur(idx, { deliveryOverride: { ...cur, ...patch } as any });
  };

  const addSurcharge = (idx: number) => {
    const j = jurisdictions[idx] as any;
    const list = Array.isArray(j.surchargesOverride) ? j.surchargesOverride.slice() : [];
    list.push({ code: `svc_${list.length + 1}`, label: '', percentBps: 0, taxable: false });
    updateJur(idx, { surchargesOverride: list });
  };
  const updSurcharge = (idx: number, sIdx: number, patch: any) => {
    const j = jurisdictions[idx] as any;
    const list = Array.isArray(j.surchargesOverride) ? j.surchargesOverride.slice() : [];
    list[sIdx] = { ...list[sIdx], ...patch };
    updateJur(idx, { surchargesOverride: list });
  };
  const delSurcharge = (idx: number, sIdx: number) => {
    const j = jurisdictions[idx] as any;
    const list = Array.isArray(j.surchargesOverride) ? j.surchargesOverride.slice() : [];
    list.splice(sIdx, 1);
    updateJur(idx, { surchargesOverride: list.length ? list : undefined });
  };

  return (
    <div className="card shadow-sm mb-3">
      <div className="card-header d-flex justify-content-between align-items-center">
        <strong>Jurisdictions (editor)</strong>
        <button className="btn btn-sm btn-outline-primary" onClick={addJur}>Add rule</button>
      </div>
      <div className="card-body">
        {(!jurisdictions || jurisdictions.length === 0) && (
          <div className="text-muted">
            No jurisdiction overrides configured.
            <div className="small">(Aquí puedes crearlas. Se guardan con “Save profile”.)</div>
          </div>
        )}

        {jurisdictions.map((j, idx) => (
          <div key={idx} className="border rounded p-2 mb-3">
            <div className="d-flex justify-content-between align-items-start">
              <div className="w-100">
                <div className="row">
                  <div className="col-md-3 mb-2">
                    <label className="form-label">Code</label>
                    <input
                      className="form-control"
                      value={j.code || ''}
                      onChange={(e) => updateJur(idx, { code: e.target.value.trim() })}
                    />
                  </div>
                  <div className="col-md-9 mb-2">
                    <label className="form-label">Match</label>
                    <div className="row">
                      <div className="col-md-3 mb-2">
                        <input
                          className="form-control"
                          placeholder="country"
                          value={j.match?.country || ''}
                          onChange={(e) => updateMatch(idx, 'country', e.target.value)}
                        />
                      </div>
                      <div className="col-md-3 mb-2">
                        <input
                          className="form-control"
                          placeholder="state"
                          value={(j.match as any)?.state || ''}
                          onChange={(e) => updateMatch(idx, 'state', e.target.value)}
                        />
                      </div>
                      <div className="col-md-3 mb-2">
                        <input
                          className="form-control"
                          placeholder="city"
                          value={j.match?.city || ''}
                          onChange={(e) => updateMatch(idx, 'city', e.target.value)}
                        />
                      </div>
                      <div className="col-md-3 mb-2">
                        <input
                          className="form-control"
                          placeholder="zipPrefix"
                          value={j.match?.zipPrefix || ''}
                          onChange={(e) => updateMatch(idx, 'zipPrefix', e.target.value)}
                        />
                      </div>
                    </div>
                    <div className="small text-muted">Prioridad: zipPrefix &gt; city &gt; state &gt; country.</div>
                  </div>
                </div>

                {/* Overrides: rates */}
                <div className="mt-2">
                  <div className="d-flex justify-content-between align-items-center">
                    <strong>Rates override</strong>
                  </div>
                  <RatesEditor
                    rates={j.ratesOverride || []}
                    onChange={(next) => setRates(idx, next)}
                    pricesIncludeTax={true}
                  />
                </div>

                {/* Overrides: surcharges */}
                <div className="mt-2">
                  <div className="d-flex justify-content-between align-items-center">
                    <strong>Surcharges override</strong>
                    <button className="btn btn-sm btn-outline-secondary" onClick={() => addSurcharge(idx)}>
                      Add surcharge
                    </button>
                  </div>
                  {Array.isArray((j as any).surchargesOverride) && (j as any).surchargesOverride.length > 0 ? (
                    <div className="mt-2 d-flex flex-column gap-2">
                      {(j as any).surchargesOverride.map((s: any, sIdx: number) => (
                        <div key={sIdx} className="border rounded p-2">
                          <div className="row">
                            <div className="col-md-3 mb-2">
                              <label className="form-label">Code</label>
                              <input className="form-control" value={s.code || ''} onChange={(e) => updSurcharge(idx, sIdx, { code: e.target.value })} />
                            </div>
                            <div className="col-md-3 mb-2">
                              <label className="form-label">Label</label>
                              <input className="form-control" value={s.label || ''} onChange={(e) => updSurcharge(idx, sIdx, { label: e.target.value })} />
                            </div>
                            <div className="col-md-3 mb-2">
                              <label className="form-label">Rate (%)</label>
                              <div className="input-group">
                                <input
                                  type="number"
                                  min={0}
                                  step="0.01"
                                  className="form-control"
                                  value={((s.percentBps || 0) / 100).toString()}
                                  onChange={(e) => updSurcharge(idx, sIdx, { percentBps: Math.round(parseFloat(e.target.value || '0') * 100) })}
                                />
                                <span className="input-group-text">%</span>
                              </div>
                            </div>
                            <div className="col-md-3 mb-2">
                              <label className="form-label">Taxable?</label>
                              <div className="form-check form-switch">
                                <input
                                  className="form-check-input"
                                  type="checkbox"
                                  checked={!!s.taxable}
                                  onChange={(e) => updSurcharge(idx, sIdx, { taxable: e.target.checked })}
                                />
                              </div>
                              {s.taxable && (
                                <div className="mt-2">
                                  <label className="form-label">Tax code</label>
                                  <select
                                    className="form-select"
                                    value={s.taxCode || ''}
                                    onChange={(e) => updSurcharge(idx, sIdx, { taxCode: e.target.value || undefined })}
                                  >
                                    <option value="">(choose)</option>
                                    {rateCodes.map((c) => <option key={c} value={c}>{c}</option>)}
                                  </select>
                                </div>
                              )}
                            </div>
                          </div>
                          <div className="text-end">
                            <button className="btn btn-sm btn-outline-danger" onClick={() => delSurcharge(idx, sIdx)}>Remove surcharge</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-muted small mt-1">No surcharges override.</div>
                  )}
                </div>

                {/* Overrides: delivery */}
                <div className="mt-2">
                  <strong>Delivery override</strong>
                  <div className="row mt-1">
                    <div className="col-md-4 mb-2">
                      <label className="form-label">Mode</label>
                      <select
                        className="form-select"
                        value={(j as any).deliveryOverride?.mode || 'out_of_scope'}
                        onChange={(e) => setDelivery(idx, { mode: e.target.value })}
                      >
                        <option value="out_of_scope">Out of scope</option>
                        <option value="as_line">As line</option>
                      </select>
                    </div>
                    <div className="col-md-4 mb-2">
                      <label className="form-label">Taxable?</label>
                      <div className="form-check form-switch">
                        <input
                          className="form-check-input"
                          type="checkbox"
                          checked={!!(j as any).deliveryOverride?.taxable}
                          onChange={(e) => setDelivery(idx, { taxable: e.target.checked })}
                        />
                      </div>
                    </div>
                    <div className="col-md-4 mb-2">
                      <label className="form-label">Tax code</label>
                      <select
                        className="form-select"
                        value={(j as any).deliveryOverride?.taxCode || ''}
                        onChange={(e) => setDelivery(idx, { taxCode: e.target.value || undefined })}
                        disabled={!((j as any).deliveryOverride?.taxable)}
                      >
                        <option value="">(choose)</option>
                        {rateCodes.map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                  </div>
                </div>

                {/* Overrides: flags */}
                <div className="row mt-2">
                  <div className="col-md-6 mb-2">
                    <label className="form-label">pricesIncludeTax override</label>
                    <div className="form-check form-switch">
                      <input
                        className="form-check-input"
                        type="checkbox"
                        checked={(j as any).pricesIncludeTaxOverride === true}
                        onChange={(e) =>
                          updateJur(idx, { pricesIncludeTaxOverride: e.target.checked ? true : undefined } as any)
                        }
                      />
                    </div>
                  </div>
                  <div className="col-md-6 mb-2">
                    <label className="form-label">rounding override</label>
                    <select
                      className="form-select"
                      value={(j as any).roundingOverride || ''}
                      onChange={(e) =>
                        updateJur(idx, { roundingOverride: (e.target.value || undefined) as any })
                      }
                    >
                      <option value="">(inherit)</option>
                      <option value="half_up">half_up</option>
                      <option value="half_even">half_even</option>
                    </select>
                  </div>
                </div>
              </div>

              <div className="ms-2">
                <button className="btn btn-outline-danger btn-sm" onClick={() => removeJur(idx)}>
                  Remove
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="card-footer">
        <div className="small text-muted">
          Los overrides se guardan dentro del mismo <code>taxProfiles/*</code> al pulsar “Save profile”.
        </div>
      </div>
    </div>
  );
}

/* ====================== Inline Test ====================== */
function InlineTest({ profile }: { profile: TaxProfile }) {
  const [qty, setQty] = useState(2);
  const [unit, setUnit] = useState(2500); // 25.00
  const [addons, setAddons] = useState(0);

  const { calculateTaxSnapshot } = require('@/lib/tax/engine'); // client-only demo
  const snapshot = useMemo(() => {
    try {
      return calculateTaxSnapshot(
        {
          currency: profile.currency,
          orderType: 'dine-in',
          lines: [{ lineId: 'demo', quantity: qty, unitPriceCents: unit, addonsCents: addons }],
          customer: {},
        },
        profile
      );
    } catch {
      return null;
    }
  }, [qty, unit, addons, profile]);

  return (
    <div>
      <div className="mb-2">
        <label className="form-label">Qty</label>
        <input
          type="number"
          className="form-control"
          value={qty}
          onChange={(e) => setQty(parseInt(e.target.value || '0'))}
        />
      </div>
      <div className="mb-2">
        <label className="form-label">Unit price (cents)</label>
        <input
          type="number"
          className="form-control"
          value={unit}
          onChange={(e) => setUnit(parseInt(e.target.value || '0'))}
        />
      </div>
      <div className="mb-2">
        <label className="form-label">Addons (cents)</label>
        <input
          type="number"
          className="form-control"
          value={addons}
          onChange={(e) => setAddons(parseInt(e.target.value || '0'))}
        />
      </div>

      {snapshot ? (
        <div className="mt-2 small">
          <div>Subtotal: {(snapshot.totals.subTotalCents / 100).toFixed(2)} {snapshot.currency}</div>
          <div>Tax: {(snapshot.totals.taxCents / 100).toFixed(2)} {snapshot.currency}</div>
          <div className="fw-semibold">Grand total: {(snapshot.totals.grandTotalCents / 100).toFixed(2)} {snapshot.currency}</div>
        </div>
      ) : (
        <div className="text-muted">—</div>
      )}
    </div>
  );
}
