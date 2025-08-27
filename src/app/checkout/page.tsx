'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useCart, buildQuotePayload } from '@/lib/cart/context';
import { useAuth } from '@/app/providers';

/* =======================
   Formato y utilidades
======================= */
const fmtQ = (n?: number | null) => {
  const v = Number.isFinite(Number(n)) ? Number(n) : 0;
  return `Q ${v.toFixed(2)}`;
};
const centsToQ = (c?: number | null) => {
  if (!Number.isFinite(Number(c))) return 0;
  return Number(c) / 100;
};
const toNum = (x: any) => {
  const n = Number(x);
  return Number.isFinite(n) ? n : undefined;
};

function getQty(l: any) {
  return Number(l?.quantity ?? l?.qty ?? 1) || 1;
}
function getName(l: any) {
  const n = l?.menuItemName ?? l?.name ?? l?.menuItem?.name;
  return (n && String(n).trim()) || 'Ítem';
}
function getUnitPriceQ(l: any): number | undefined {
  let v = toNum(l?.unitPrice);
  if (v !== undefined) return v;
  v = toNum(l?.price);
  if (v !== undefined) return v;
  v = toNum(l?.unitPriceCents);
  if (v !== undefined) return v / 100;
  v = toNum(l?.priceCents);
  if (v !== undefined) return v / 100;
  // Fallback: precio dentro de menuItem (como lo guardas en la BD)
  v = toNum(l?.menuItem?.priceCents);
  if (v !== undefined) return v / 100;
  v = toNum(l?.menuItem?.price);
  if (v !== undefined) return v;
  return undefined;
}
function getLineSubtotalQ(l: any): number | undefined {
  let v = toNum(l?.lineTotal);
  if (v !== undefined) return v;
  v = toNum(l?.total);
  if (v !== undefined) return v;
  v = toNum(l?.lineTotalCents);
  if (v !== undefined) return v / 100;
  v = toNum(l?.totalCents);
  if (v !== undefined) return v / 100;
  const unit = getUnitPriceQ(l);
  if (unit !== undefined) return unit * getQty(l);
  return undefined;
}

/* =======================
   Mensajes de error backend
======================= */
const CODE_HINT: Record<string, string> = {
  MENU_ITEM_NOT_FOUND: "El plato no existe.",
  MENU_ITEM_UNAVAILABLE: "El plato no está disponible.",
  INVALID_GROUP_FOR_ITEM: "El grupo no pertenece al plato.",
  GROUP_MIN_VIOLATION: "Faltan opciones mínimas en algún grupo.",
  GROUP_MAX_VIOLATION: "Se excedió el máximo permitido en un grupo.",
  OPTION_NOT_FOUND: "Alguna opción no existe.",
  OPTION_INACTIVE: "Alguna opción está inactiva.",
  OPTION_WRONG_GROUP: "Alguna opción no pertenece al grupo.",
  CURRENCY_MISMATCH: "Incongruencia de moneda configurada.",
};

/* =======================
   HTTP helpers
======================= */
async function getJson<T = any>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: 'no-store', ...init });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data?.error || `HTTP ${res.status}`), { code: data?.code });
  return data;
}

/* =======================
   Cachés: grupos y opciones (para nombres)
======================= */
const groupsByItem: Record<string, any[]> = {};
const optionsByGroup: Record<string, any[]> = {};

async function fetchGroups(menuItemId: string) {
  if (!groupsByItem[menuItemId]) {
    const g = await getJson<{ items: any[] }>(`/api/option-groups?menuItemId=${encodeURIComponent(menuItemId)}`);
    groupsByItem[menuItemId] = g.items || [];
  }
  return groupsByItem[menuItemId];
}
async function fetchOptions(groupId: string) {
  if (!optionsByGroup[groupId]) {
    const o = await getJson<{ items: any[] }>(`/api/option-items?groupId=${encodeURIComponent(groupId)}`);
    optionsByGroup[groupId] = (o.items || []).filter((x: any) => x.isActive !== false);
  }
  return optionsByGroup[groupId];
}

/* =======================
   Completar selecciones mínimas
======================= */
async function ensureRequiredSelections(payload: any) {
  const items = payload.items || [];
  for (const it of items) {
    const menuItemId = String(it.menuItemId);
    const groups = await fetchGroups(menuItemId);
    const required = (groups || []).filter((g: any) => Number(g?.minSelect ?? 0) >= 1);

    const current = Array.isArray(it.options) ? it.options.slice() : []; // [{groupId, optionItemIds[]}]
    const idxByGroup: Record<string, number> = {};
    current.forEach((x: any, i: number) => (idxByGroup[String(x.groupId)] = i));

    for (const g of required) {
      const gid = String(g.id);
      const min = Number(g.minSelect ?? 0);
      const max = Number(g.maxSelect ?? 0);
      const idx = idxByGroup[gid] ?? -1;
      const curSel = idx >= 0 ? (Array.isArray(current[idx]?.optionItemIds) ? current[idx].optionItemIds : []) : [];
      if (min >= 1 && (!curSel || curSel.length < min)) {
        const opts = await fetchOptions(gid);
        if (!opts.length) {
          const err = new Error(`El grupo "${g.name || gid}" no tiene opciones disponibles.`);
          (err as any).code = 'GROUP_MIN_VIOLATION';
          throw err;
        }
        const need = max > 0 ? Math.min(min, max) : min;
        const pick = opts.slice(0, need).map((o: any) => String(o.id));
        if (idx >= 0) current[idx] = { groupId: gid, optionItemIds: pick };
        else current.push({ groupId: gid, optionItemIds: pick });
      }
    }
    it.options = current;
  }
  return payload;
}

/* =======================
   selections → formato OPS
======================= */
async function selectionsToOpsOptions(
  menuItemId: string,
  selections: any[]
): Promise<Array<{ groupName: string; selected: Array<{ name: string; priceDelta: number }> }>> {
  const res: Array<{ groupName: string; selected: Array<{ name: string; priceDelta: number }> }> = [];
  if (!Array.isArray(selections) || !selections.length) return res;

  const groups = await fetchGroups(menuItemId);
  const groupMap = new Map(groups.map(g => [String(g.id), g]));

  for (const sel of selections) {
    const gid = String(sel.groupId);
    const group = groupMap.get(gid);
    if (!group) continue;

    const opts = await fetchOptions(gid);
    const optMap = new Map(opts.map(o => [String(o.id), o]));

    const selected = (sel.optionItemIds || []).map((oid: any) => {
      const o = optMap.get(String(oid));
      const name = String(o?.name ?? oid);
      const delta =
        toNum(o?.priceDelta) ??
        toNum(o?.priceExtra) ??
        (toNum(o?.priceDeltaCents) !== undefined ? (o.priceDeltaCents / 100) : undefined) ??
        (toNum(o?.priceExtraCents) !== undefined ? (o.priceExtraCents / 100) : undefined) ??
        0;
      return { name, priceDelta: Number(delta || 0) };
    });

    res.push({ groupName: String(group?.name ?? gid), selected });
  }
  return res;
}

/* =======================
   Página
======================= */
export default function CheckoutPage() {
  const { cart, setMeta, setQuantity, remove, clear } = useCart();
  const { idToken } = useAuth();

  const [placeBusy, setPlaceBusy] = useState(false);
  const [quoteBusy, setQuoteBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<any>(null);
  const [code, setCode] = useState<string | null>(null);
  const [quote, setQuote] = useState<any | null>(null);

  const lines = cart.lines || [];
  const hasLines = lines.length > 0;

  /* ---------- Cotizar (auto) ---------- */
  useEffect(() => {
    (async () => {
      if (!hasLines) { setQuote(null); return; }
      try {
        const base = buildQuotePayload(cart);
        const enriched = await ensureRequiredSelections({ ...base });
        const data = await getJson('/api/cart/quote', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(enriched),
        });
        setQuote(data || null);
      } catch (e) {
        // silencioso
        setQuote(null);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(lines), cart.type, cart.tableNumber, cart.deliveryAddress, cart.notes, cart.tipAmount]);

  /* ---------- Cotizar (manual) ---------- */
  async function quoteNow() {
    try {
      setQuoteBusy(true);
      setErr(null); setCode(null);
      const base = buildQuotePayload(cart);
      const enriched = await ensureRequiredSelections({ ...base });
      const data = await getJson('/api/cart/quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(enriched),
      });
      setQuote(data || null);
    } catch (e: any) {
      setCode(e?.code || null);
      setErr(e?.message || 'No se pudo cotizar');
      setQuote(null);
    } finally {
      setQuoteBusy(false);
    }
  }

  /* ------- Totales a mostrar ------- */
  const totals = useMemo(() => {
    // Subtotal de respaldo: usar primero el subtotal de cada línea dentro del quote (si existe),
    // y si no, calcular desde el item local (precio base * qty).
    const fallbackSubtotalLocal = lines.reduce((acc, l, idx) => {
      let sub: number | undefined;
      const qLine = (quote?.lines?.[idx]) || (quote?.items?.[idx]);
      if (qLine) {
        const lc = toNum(qLine?.lineTotalCents);
        const tc = toNum(qLine?.totalCents);
        const ll = toNum(qLine?.lineTotal);
        const tl = toNum(qLine?.total);
        if (lc !== undefined) sub = centsToQ(lc);
        else if (tc !== undefined) sub = centsToQ(tc);
        else if (ll !== undefined) sub = ll;
        else if (tl !== undefined) sub = tl;
      }
      if (sub === undefined) sub = getLineSubtotalQ(l) ?? 0;
      return acc + sub;
    }, 0);

    // 1) amounts (formato OPS) si viene del backend
    if (quote?.amounts && typeof quote.amounts.total === 'number') {
      const a = quote.amounts;
      const t = {
        subtotal: (toNum(a.subtotal) ?? 0) > 0 ? Number(a.subtotal) : fallbackSubtotalLocal,
        tax: Number(a.tax || 0),
        service: Number(a.serviceFee || 0),
        discount: Number(a.discount || 0),
        tip: Number(a.tip || 0),
        total: Number(a.total || 0),
      };
      if (t.total > 0) return t;
    }

    // 2) centavos → Q
    const subtotalC = toNum(quote?.totals?.subtotalCents) ?? toNum(quote?.subtotalCents);
    const taxC = toNum(quote?.totals?.taxCents) ?? toNum(quote?.taxCents);
    const serviceC = toNum(quote?.totals?.serviceFeeCents) ?? toNum(quote?.serviceFeeCents);
    const discountC = toNum(quote?.totals?.discountCents) ?? toNum(quote?.discountCents);
    const totalC = toNum(quote?.totals?.totalCents) ?? toNum(quote?.totalCents);

    if (totalC !== undefined && totalC > 0) {
      const tipQ = Number(cart.tipAmount || 0);
      return {
        subtotal: subtotalC !== undefined ? centsToQ(subtotalC) : fallbackSubtotalLocal,
        tax: centsToQ(taxC),
        service: centsToQ(serviceC),
        discount: centsToQ(discountC),
        tip: tipQ,
        total: centsToQ(totalC) + tipQ,
      };
    }

    // 3) Fallback local (sin quote válido)
    const tipQ = Number(cart.tipAmount || 0);
    return { subtotal: fallbackSubtotalLocal, tax: 0, service: 0, discount: 0, tip: tipQ, total: fallbackSubtotalLocal + tipQ };
  }, [quote, lines, cart.tipAmount]);

  /* ------- Subtotal de línea desde quote (fallback local) ------- */
  function lineSubtotalFromQuote(index: number): number | undefined {
    const qLine = (quote?.lines && quote.lines[index]) || (quote?.items && quote.items[index]) || null;
    if (!qLine) return undefined;
    if (Number.isFinite(qLine?.lineTotalCents)) return centsToQ(qLine.lineTotalCents);
    if (Number.isFinite(qLine?.totalCents)) return centsToQ(qLine.totalCents);
    if (Number.isFinite(qLine?.lineTotal)) return Number(qLine.lineTotal);
    if (Number.isFinite(qLine?.total)) return Number(qLine.total);
    return undefined;
  }

  /* ------- Crear orden ------- */
  async function placeOrder() {
    setPlaceBusy(true); setErr(null); setOk(null); setCode(null);
    try {
      if (!idToken) throw new Error('Debes iniciar sesión.');
      if (!hasLines) throw new Error('El carrito está vacío.');

      if (cart.type === 'delivery') {
        if (!cart.deliveryAddress?.trim() || !cart.contactPhone?.trim()) {
          throw new Error('Para delivery, completa dirección y teléfono.');
        }
      } else {
        const mesaCheck = cart.tableNumber?.trim();
        if (!mesaCheck) {
          throw new Error('Para dine-in, ingresa el número de mesa.');
        }
      }

      // 1) Base del carrito
      const base = buildQuotePayload(cart);
      const enriched = await ensureRequiredSelections({ ...base });

      // 2) Ítems en formato que OPS lee
      const itemsForOps = [];
      for (let i = 0; i < lines.length; i++) {
        const src: any = (lines as any[])[i] || {};
        const menuItemId = String(src.menuItemId);
        const quantity = getQty(src);
        const menuItemName = getName(src);
        const selections = Array.isArray(enriched.items?.[i]?.options) ? enriched.items[i].options : (src.selections || []);
        const opsOptions = await selectionsToOpsOptions(menuItemId, selections);

        itemsForOps.push({
          menuItemId,
          menuItemName,
          quantity,
          options: opsOptions,
        });
      }

      // 3) Amounts (GTQ) — usa lo que calculamos arriba
      const amounts = {
        subtotal: totals.subtotal,
        tax: totals.tax,
        serviceFee: totals.service,
        discount: totals.discount,
        tip: totals.tip,
        total: totals.total,
      };

      const body: any = {
        type: cart.type,
        items: itemsForOps,
        amounts,
        notes: cart.notes?.trim() || '',
        meta: { ...(enriched.meta || {}) },
        currency: 'GTQ',
      };

      if (cart.type === 'dine_in') {
        const mesa = cart.tableNumber?.trim();
        if (mesa) {
          body.tableNumber = mesa;
          body.meta.tableNumber = mesa; // compat
        }
      } else {
        body.deliveryAddress = cart.deliveryAddress?.trim() || '';
        body.contactPhone = cart.contactPhone?.trim() || '';
      }

      body.raw = {
        selections: enriched.items?.map((it: any) => it?.options) || [],
      };

      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify(body),
        cache: 'no-store',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setCode(data?.code || null);
        throw new Error(data?.error || `HTTP ${res.status}`);
      }

      setCode(null);
      setErr(null);
      setOk(data);
      clear();
      setQuote(null);
    } catch (e: any) {
      setErr(e?.message || 'No se pudo crear el pedido');
    } finally {
      setPlaceBusy(false);
    }
  }

  return (
    <div className="container py-4" aria-busy={placeBusy || quoteBusy}>
      <h1 className="mb-3">Checkout (pre-order)</h1>

      {!hasLines ? (
        <div className="alert alert-secondary">
          Tu carrito está vacío. Ve al <Link href="/menu">menú</Link> para agregar productos.
        </div>
      ) : (
        <>
          {err && (
            <div className="alert alert-danger">
              {err}
              {code && CODE_HINT[code] ? <div className="small text-muted mt-1">{CODE_HINT[code]}</div> : null}
            </div>
          )}

          {/* Tipo de pedido */}
          <div className="mb-3">
            <label className="form-label">Tipo de pedido</label>
            <select
              className="form-select"
              value={cart.type}
              onChange={(e) => setMeta({ type: e.target.value as 'dine_in' | 'delivery' })}
            >
              <option value="dine_in">Dine-in</option>
              <option value="delivery">Delivery</option>
            </select>
          </div>

          {/* Datos según tipo */}
          {cart.type === 'dine_in' ? (
            <div className="row g-3">
              <div className="col-md-4">
                <label className="form-label">Mesa</label>
                <input
                  className="form-control"
                  placeholder="Mesa 1"
                  value={cart.tableNumber || ''}
                  onChange={(e) => setMeta({ tableNumber: e.target.value })}
                />
              </div>
              <div className="col-md-8">
                <label className="form-label">Notas</label>
                <input
                  className="form-control"
                  placeholder="Notas del pedido"
                  value={cart.notes || ''}
                  onChange={(e) => setMeta({ notes: e.target.value })}
                />
              </div>
            </div>
          ) : (
            <div className="row g-3">
              <div className="col-md-8">
                <label className="form-label">Dirección de entrega</label>
                <input
                  className="form-control"
                  placeholder="Dirección exacta"
                  value={cart.deliveryAddress || ''}
                  onChange={(e) => setMeta({ deliveryAddress: e.target.value })}
                />
              </div>
              <div className="col-md-4">
                <label className="form-label">Teléfono de contacto</label>
                <input
                  className="form-control"
                  placeholder="5555-5555"
                  value={cart.contactPhone || ''}
                  onChange={(e) => setMeta({ contactPhone: e.target.value })}
                />
              </div>
              <div className="col-12">
                <label className="form-label">Notas</label>
                <input
                  className="form-control"
                  placeholder="Notas del pedido"
                  value={cart.notes || ''}
                  onChange={(e) => setMeta({ notes: e.target.value })}
                />
              </div>
            </div>
          )}

          {/* Carrito */}
          <div className="table-responsive my-3">
            <table className="table align-middle">
              <thead>
                <tr>
                  <th>Producto</th>
                  <th style={{ width: 200 }}>Opciones</th>
                  <th style={{ width: 110 }}>Cantidad</th>
                  <th style={{ width: 140 }} className="text-end">Subtotal</th>
                  <th style={{ width: 80 }} className="text-end"></th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l, idx) => {
                  const name = getName(l);
                  const qty = getQty(l);
                  const subtotal = lineSubtotalFromQuote(idx) ?? getLineSubtotalQ(l) ?? 0;
                  return (
                    <tr key={(l as any).id ?? (l as any).menuItemId ?? idx}>
                      <td>
                        <div className="fw-semibold">{name}</div>
                        <div className="text-muted small">{(l as any).menuItemId ?? (l as any).id}</div>
                      </td>
                      <td className="small">
                        {Array.isArray((l as any).selections) && (l as any).selections.length
                          ? (l as any).selections.map((s: any) => `${s.groupId}: ${(s.optionItemIds || []).join(', ')}`).join(' | ')
                          : <span className="text-secondary">—</span>}
                      </td>
                      <td>
                        <div className="input-group input-group-sm" style={{ width: 110 }}>
                          <button
                            className="btn btn-outline-secondary"
                            onClick={() => setQuantity(l.id, Math.max(1, qty - 1))}
                            disabled={placeBusy || quoteBusy}
                            aria-label="menos"
                          >−</button>
                          <input
                            type="number"
                            min={1}
                            value={qty}
                            onChange={(e) => setQuantity(l.id, Math.max(1, Number(e.target.value || 1)))}
                            className="form-control text-center"
                          />
                          <button
                            className="btn btn-outline-secondary"
                            onClick={() => setQuantity(l.id, qty + 1)}
                            disabled={placeBusy || quoteBusy}
                            aria-label="más"
                          >+</button>
                        </div>
                      </td>
                      <td className="text-end">{fmtQ(subtotal)}</td>
                      <td className="text-end">
                        <button
                          className="btn btn-sm btn-outline-danger"
                          onClick={() => remove(l.id)}
                          disabled={placeBusy || quoteBusy}
                        >
                          Quitar
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Totales */}
          <div className="d-flex flex-column align-items-end gap-1">
            <div className="small text-muted">Subtotal: <span className="fw-semibold">{fmtQ(totals.subtotal)}</span></div>
            {!!totals.tax && <div className="small text-muted">Impuestos: <span className="fw-semibold">{fmtQ(totals.tax)}</span></div>}
            {!!totals.service && <div className="small text-muted">Servicio: <span className="fw-semibold">{fmtQ(totals.service)}</span></div>}
            {!!totals.discount && <div className="small text-muted">Descuento: <span className="fw-semibold">−{fmtQ(totals.discount)}</span></div>}

            <div className="d-flex align-items-center gap-2 mt-2">
              <label className="form-label m-0">Propina (Q):</label>
              <input
                type="number"
                min={0}
                step="0.01"
                className="form-control form-control-sm"
                style={{ width: 140 }}
                value={cart.tipAmount ?? 0}
                onChange={(e) => setMeta({ tipAmount: Number(e.target.value || 0) })}
              />
            </div>

            <div className="fs-6 mt-1">Total: <span className="fw-bold">{fmtQ(totals.total)}</span></div>
          </div>

          {/* Acciones */}
          <div className="d-flex gap-2 mt-3 justify-content-end">
            <button
              className="btn btn-outline-primary"
              onClick={quoteNow}
              disabled={quoteBusy || !hasLines}
            >
              {quoteBusy ? 'Cotizando…' : 'Cotizar'}
            </button>

            <button
              className="btn btn-success"
              onClick={placeOrder}
              disabled={placeBusy || !idToken || !hasLines}
            >
              {placeBusy ? 'Procesando…' : 'Confirmar pedido'}
            </button>

            <Link className="btn btn-outline-secondary" href="/menu">
              Seguir comprando
            </Link>
          </div>

          {ok && (
            <div className="mt-3 p-3 border rounded bg-success-subtle">
              <div className="fw-semibold mb-2">Pedido creado</div>
              <pre className="small mb-2">{JSON.stringify(ok, null, 2)}</pre>
              <div>
                Ir al tablero de operación: <Link href="/ops">/ops</Link>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
