/* src/app/(client)/app/orders/[id]/page.tsx */
'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import '@/lib/firebase/client';
import { getFirestore, doc, onSnapshot } from 'firebase/firestore';

type OrderDoc = {
  status?: string;
  total?: number;
  items?: any[];
  createdAt?: any;
};

export default function OrderTrackPage() {
  const params = useParams<{ id: string }>();
  const orderId = params?.id as string;
  const [order, setOrder] = useState<OrderDoc | null>(null);

  useEffect(() => {
    const db = getFirestore();
    const ref = doc(db, 'orders', orderId);
    const unsub = onSnapshot(ref, (snap) => setOrder(snap.data() as OrderDoc ?? null));
    return () => unsub();
  }, [orderId]);

  if (!order) return <p>Loading order...</p>;

  return (
    <section className="space-y-3">
      <h1 className="text-xl font-semibold">Order #{orderId}</h1>
      <p>Status: <b>{order.status ?? 'unknown'}</b></p>
      <p>Total: ${Number(order.total ?? 0).toFixed(2)}</p>
      <div>
        <h2 className="font-semibold">Items</h2>
        <pre className="text-xs bg-gray-50 border rounded p-2 overflow-auto">
{JSON.stringify(order.items ?? [], null, 2)}
        </pre>
      </div>
    </section>
  );
}
