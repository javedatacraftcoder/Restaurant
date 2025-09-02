'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

type TS = any;

type OptItem = {
  id?: string; name?: string;
  price?: number; priceCents?: number;
  priceDelta?: number; priceDeltaCents?: number;
  priceExtra?: number; priceExtraCents?: number;
};
type Line = {
  menuItemName?: string; name?: string; menuItem?: { price?: number; priceCents?: number } | null;
  quantity?: number;
  basePrice?: number; unitPrice?: number; unitPriceCents?: number; price?: number; priceCents?: number;
  totalCents?: number; lineTotal?: number;
  addons?: Array<string | { name?: string; price?: number; priceCents?: number }>;
  optionGroups?: Array<{ groupId?: string; groupName?: string; type?: 'single'|'multiple'; items: OptItem[] }>;
  options?: Array<{ groupName: string; selected: OptItem[] }>;
};
type Order = {
  id: string; orderNumber?: string|number; status?: string; currency?: string;
  createdAt?: TS;
  orderInfo?: { type?: 'dine-in'|'delivery'; table?: string } | null;
  tableNumber?: string | null;
  items?: Line[]; lines?: any[];
  amounts?: { total?: number } | null; totals?: { totalCents?: number } | null; orderTotal?: number | null;
  userEmail?: string|null; createdBy?: { email?: string|null } | null;
};

const toNum=(x:any)=> (Number.isFinite(Number(x))?Number(x):undefined);
const centsToQ=(c?:number)=> (Number.isFinite(c)?Number(c)/100:0);
function tsToDate(ts:TS){ if(!ts) return null; try{
  if (typeof (ts as any).toDate === 'function') return (ts as any).toDate();
  if (typeof (ts as any).seconds === 'number') return new Date((ts as any).seconds*1000);
  if (typeof ts === 'number') return new Date(ts);
  const d = new Date(ts); return isNaN(d.getTime())? null : d;
}catch{return null;} }
function fmtMoney(n?:number, cur='GTQ'){ const v=Number(n||0); try{ return new Intl.NumberFormat('es-GT',{style:'currency',currency:cur}).format(v);}catch{return `Q ${v.toFixed(2)}`;} }
function extractDeltaQ(x:any){ const a=toNum(x?.priceDelta); if(a!==undefined) return a;
  const b=toNum(x?.priceExtra); if(b!==undefined) return b;
  const ac=toNum(x?.priceDeltaCents); if(ac!==undefined) return ac/100;
  const bc=toNum(x?.priceExtraCents); if(bc!==undefined) return bc/100;
  const p=toNum(x?.price); if(p!==undefined) return p;
  const pc=toNum(x?.priceCents); if(pc!==undefined) return pc/100;
  return 0;
}
function perUnitAddonsQ(l:Line){ let s=0;
  if(Array.isArray(l.optionGroups)) for(const g of l.optionGroups) for(const it of (g.items||[])) s += extractDeltaQ(it);
  if(Array.isArray(l.options)) for(const g of l.options) for(const it of (g.selected||[])) s += extractDeltaQ(it);
  for (const it of (l.addons||[])) {
    if (typeof it === 'string') continue;
    const p = toNum(it?.price) ?? (toNum(it?.priceCents)!==undefined ? Number(it!.priceCents)/100 : undefined);
    s += p ?? 0;
  }
  return s;
}
function baseUnitPriceQ(l:Line){ const b=toNum(l.basePrice); if(b!==undefined) return b;
  const upc=toNum(l.unitPriceCents); if(upc!==undefined) return upc/100;
  const up=toNum(l.unitPrice); if(up!==undefined) return up;
  const pc=toNum(l.priceCents); if(pc!==undefined) return pc/100;
  const p=toNum(l.price); if(p!==undefined) return p;
  const miC=toNum(l.menuItem?.priceCents); if(miC!==undefined) return miC/100;
  const mi=toNum(l.menuItem?.price); if(mi!==undefined) return mi;
  const tC=toNum(l.totalCents), q=Number(l.quantity||1); if(tC!==undefined && q>0){ const per=tC/100/q; const add=perUnitAddonsQ(l); return Math.max(0, per - add); }
  return 0;
}
function lineTotalQ(l:Line){ if(toNum(l.lineTotal)!==undefined) return Number(l.lineTotal);
  if(toNum(l.totalCents)!==undefined) return Number(l.totalCents)/100;
  const q=Number(l.quantity||1); return (baseUnitPriceQ(l)+perUnitAddonsQ(l))*q;
}
function orderTotalQ(o:Order){ if(toNum(o.amounts?.total)!==undefined) return Number(o.amounts!.total);
  if(toNum(o.orderTotal)!==undefined) return Number(o.orderTotal);
  if(toNum(o.totals?.totalCents)!==undefined) return centsToQ(o.totals!.totalCents!);
  const lines=(o.items||[]); if(lines.length) return lines.reduce((acc,l)=>acc+lineTotalQ(l),0);
  return 0;
}
function displayType(o:Order){ const t=o.orderInfo?.type?.toLowerCase?.(); if(t==='delivery') return 'Delivery'; if(t==='dine-in') return 'Dine-in'; return o.orderInfo?.type || '-'; }
function getQty(l:Line){ return Number(l?.quantity ?? 1) || 1; }
function getName(l:Line){ return String(l?.menuItemName ?? l?.name ?? 'Ítem'); }

type ApiList = { ok?: boolean; orders?: Order[]; items?: Order[]; error?: string };

export default function EditOrdersListPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');

  useEffect(()=>{ let alive=true;(async()=>{
    try{
      const res = await fetch('/api/orders?limit=100',{cache:'no-store'});
      const data: ApiList = await res.json();
      if(!res.ok || data?.ok===false) throw new Error(data?.error||`HTTP ${res.status}`);
      const list = (data.orders || data.items || []).map((o:any)=>o) as Order[];
      if(alive) setOrders(list);
    } catch(e){ console.error(e); } finally { if(alive) setLoading(false); }
  })(); return ()=>{alive=false}; },[]);

  const filtered = useMemo(()=>{
    const s=q.trim().toLowerCase();
    if(!s) return orders;
    return orders.filter(o=>{
      const email = (o.userEmail || o.createdBy?.email || '').toLowerCase();
      const num = String(o.orderNumber ?? o.id).toLowerCase();
      return email.includes(s) || num.includes(s);
    });
  },[orders,q]);

  return (
    <div className="container py-4">
      <div className="d-flex align-items-center justify-content-between mb-3">
        <h1 className="h4 m-0">Editar órdenes</h1>
        <div className="input-group" style={{maxWidth: 360}}>
          <span className="input-group-text">@</span>
          <input className="form-control" placeholder="Buscar por correo o #"
                 value={q} onChange={e=>setQ(e.target.value)} />
        </div>
      </div>

      {loading && <div className="alert alert-info">Cargando…</div>}

      {!loading && (
        <ul className="list-group">
          {filtered.map(o=>{
            const total = orderTotalQ(o);
            const d = tsToDate(o.createdAt)?.toLocaleString() ?? '-';
            const n = o.orderNumber ?? o.id.slice(0,6);
            return (
              <li key={o.id} className="list-group-item">
                <div className="d-flex flex-column flex-md-row align-items-start align-items-md-center justify-content-between">
                  <div>
                    <div className="fw-semibold">#{n} <span className="badge text-bg-light">{displayType(o)}</span></div>
                    <div className="small text-muted">Fecha: {d}</div>
                  </div>
                  <div className="d-flex align-items-center gap-2 mt-2 mt-md-0">
                    <div className="fw-bold">{fmtMoney(total, o.currency)}</div>
                    <Link href={`/admin/edit-orders/${o.id}/menu`} className="btn btn-primary btn-sm">Edit</Link>
                  </div>
                </div>

                {/* Detalle completo de líneas */}
                <div className="mt-2">
                  {(o.items||[]).map((l, idx)=>{
                    const qty = getQty(l);
                    const name = getName(l);
                    const base = baseUnitPriceQ(l);
                    const sum = lineTotalQ(l);
                    return (
                      <div key={idx} className="small mb-2 border-top pt-2">
                        <div className="d-flex justify-content-between">
                          <div>• {qty} × {name}</div>
                          <div className="text-muted">({fmtMoney(base, o.currency)} c/u)</div>
                        </div>

                        {/* optionGroups / options con precio */}
                        {Array.isArray(l.optionGroups) && l.optionGroups.map((g,gi)=>{
                          const rows = (g.items||[]).map((it,ii)=>{
                            const p = extractDeltaQ(it);
                            return <span key={ii}>{it?.name}{p?` (${fmtMoney(p, o.currency)})`:''}{ii<(g.items!.length-1)?', ':''}</span>;
                          });
                          return rows.length?(
                            <div key={gi} className="ms-3 text-muted">
                              <span className="fw-semibold">{g.groupName || 'Opciones'}:</span> {rows}
                            </div>
                          ):null;
                        })}

                        {Array.isArray(l.options) && l.options.map((g,gi)=>{
                          const rows = (g.selected||[]).map((it,ii)=>{
                            const p = extractDeltaQ(it);
                            return <span key={ii}>{it?.name}{p?` (${fmtMoney(p, o.currency)})`:''}{ii<(g.selected!.length-1)?', ':''}</span>;
                          });
                          return rows.length?(
                            <div key={`op-${gi}`} className="ms-3 text-muted">
                              <span className="fw-semibold">{g.groupName || 'Opciones'}:</span> {rows}
                            </div>
                          ):null;
                        })}

                        {/* addons con precio */}
                        {Array.isArray(l.addons) && l.addons.length>0 && (
                          <div className="ms-3 text-muted">
                            <span className="fw-semibold">addons:</span>{' '}
                            {l.addons.map((ad:any,ai:number)=>{
                              if (typeof ad==='string') return <span key={ai}>{ad}{ai<l.addons!.length-1?', ':''}</span>;
                              const p = toNum(ad?.price) ?? (toNum(ad?.priceCents)!==undefined ? Number(ad!.priceCents)/100 : undefined);
                              return <span key={ai}>{ad?.name}{p?` (${fmtMoney(p, o.currency)})`:''}{ai<l.addons!.length-1?', ':''}</span>;
                            })}
                          </div>
                        )}

                        <div className="d-flex justify-content-between">
                          <span className="text-muted">Subtotal línea</span>
                          <span className="text-muted">{fmtMoney(sum, o.currency)}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </li>
            );
          })}
          {filtered.length===0 && <li className="list-group-item text-muted">Sin resultados</li>}
        </ul>
      )}
    </div>
  );
}
