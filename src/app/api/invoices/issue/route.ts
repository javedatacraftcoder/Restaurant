import { NextRequest, NextResponse } from 'next/server';
import { getFirestore, doc, getDoc, runTransaction, serverTimestamp, updateDoc } from 'firebase/firestore';
import { getAuth } from 'firebase-admin/auth'; // si usas admin; opcional según tu setup

type InvoiceNumbering = {
  enabled?: boolean;
  series?: string;
  prefix?: string;
  suffix?: string;
  padding?: number;          // dígitos (ej. 6) -> 000123
  resetPolicy?: 'never'|'yearly'|'monthly'|'daily';
};

type TaxProfile = {
  b2bConfig?: {
    invoiceNumbering?: InvoiceNumbering
  }
  // ...otros campos que ya usas
};

function composeInvoiceNumber(cfg: InvoiceNumbering, n: number) {
  const pad = Math.max(0, cfg.padding ?? 0);
  const num = String(n).padStart(pad, '0');
  const parts = [
    cfg.prefix || '',
    cfg.series || '',
    num,
    cfg.suffix || ''
  ].filter(Boolean);
  // une con separadores si quieres, o sin separadores:
  // return parts.join('-'); // ejemplo pref-ABC-000123-suf
  return parts.join('');
}

function counterDocPath(now = new Date()) {
  // Sugerencia: 1 documento global + subcolecciones por policy
  // o un único doc con claves por policy. Aquí: una sola clave.
  // Si quieres reset por periodo, incluye año/mes/día en la clave.
  const y = now.getFullYear();
  const m = String(now.getMonth()+1).padStart(2,'0');
  const d = String(now.getDate()).padStart(2,'0');
  return { keyYear: `year-${y}`, keyMonth: `month-${y}-${m}`, keyDay: `day-${y}-${m}-${d}` };
}

export async function POST(req: NextRequest) {
  try {
    const { orderId } = await req.json();
    if (!orderId) return NextResponse.json({ ok:false, reason:'Missing orderId' }, { status:400 });

    const db = getFirestore();

    // 1) Leer perfil activo (como ya haces en UI)
    const profSnap = await getDoc(doc(db, 'taxProfiles', 'active'));
    if (!profSnap.exists()) return NextResponse.json({ ok:false, reason:'No active tax profile' }, { status:400 });
    const profile = profSnap.data() as TaxProfile;
    const inv = profile?.b2bConfig?.invoiceNumbering;
    if (!inv?.enabled) return NextResponse.json({ ok:false, reason:'Invoice numbering disabled' }, { status:400 });

    // 2) Transacción para consumir el contador y escribir en la orden
    const now = new Date();
    const { keyYear, keyMonth, keyDay } = counterDocPath(now);

    const countersRef = doc(db, 'counters', 'invoiceNumbering'); // un único doc
    const orderRef = doc(db, 'orders', orderId);

    const result = await runTransaction(db, async (tx) => {
      const countersSnap = await tx.get(countersRef);
      const orderSnap = await tx.get(orderRef);
      if (!orderSnap.exists()) throw new Error('Order not found');

      const o: any = orderSnap.data() || {};
      if (o.invoiceNumber) {
        // idempotencia: si ya tiene, regresa lo mismo
        return { invoiceNumber: o.invoiceNumber, issuedAt: o.invoiceIssuedAt, series: o.invoiceSeries };
      }

      // 2a) decidir clave de periodo según resetPolicy
      const key =
        inv.resetPolicy === 'daily'   ? keyDay   :
        inv.resetPolicy === 'monthly' ? keyMonth :
        inv.resetPolicy === 'yearly'  ? keyYear  :
        'global';

      const data = countersSnap.exists() ? (countersSnap.data() as any) : {};
      const current = Number(data[key]?.next ?? 1);
      const next = current + 1;

      // 2b) compón número y escribe contador
      const invoiceNumber = composeInvoiceNumber(inv, current);

      tx.set(countersRef, {
        [key]: { next },              // guarda el siguiente
        updatedAt: serverTimestamp(),
      }, { merge: true });

      tx.update(orderRef, {
        invoiceNumber,
        invoiceSeries: inv.series || null,
        invoiceIssuedAt: serverTimestamp(),
      });

      return { invoiceNumber, issuedAt: new Date().toISOString(), series: inv.series || null };
    });

    return NextResponse.json({ ok:true, ...result });
  } catch (e:any) {
    console.error('[invoices/issue] error', e);
    return NextResponse.json({ ok:false, reason: e?.message || 'Server error' }, { status:500 });
  }
}
