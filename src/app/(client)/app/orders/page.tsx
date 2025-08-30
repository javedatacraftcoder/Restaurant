/* src/app/(client)/app/orders/page.tsx */
'use client';
import Link from 'next/link';

export default function OrdersListPage() {
  const orders = [] as { id: string, status: string, total: number }[];
  return (
    <section className="space-y-3">
      <h1 className="text-xl font-semibold">My Orders</h1>
      {orders.length === 0 && <p>No orders yet.</p>}
      <ul className="space-y-2">
        {orders.map(o => (
          <li key={o.id} className="border rounded p-3 flex justify-between">
            <div>
              <p className="font-medium">Order #{o.id}</p>
              <p className="text-sm text-gray-600">{o.status}</p>
            </div>
            <div className="flex items-center gap-3">
              <span>${o.total.toFixed(2)}</span>
              <Link className="underline" href={`/app/orders/${o.id}`}>Track</Link>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
