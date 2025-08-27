// src/app/cart/page.tsx
"use client";

import { useCart } from "@/lib/cart/context";
import Link from "next/link";

export default function CartPage() {
  const { cart, setQuantity, remove, clear } = useCart();

  const empty = cart.lines.length === 0;

  return (
    <main className="p-6 max-w-4xl mx-auto space-y-4">
      <h1 className="text-2xl font-bold">Carrito</h1>

      {empty ? (
        <div className="text-sm text-gray-600">
          Tu carrito está vacío. <Link className="underline" href="/menu">Ir al menú</Link>
        </div>
      ) : (
        <>
          <div className="grid gap-2">
            {cart.lines.map((l) => (
              <div key={l.id} className="border rounded p-3">
                <div className="flex items-center justify-between">
                  <div className="font-medium">{l.menuItemName}</div>
                  <button className="text-sm text-red-600" onClick={()=>remove(l.id)}>Eliminar</button>
                </div>
                {!!l.selections?.length && (
                  <ul className="mt-1 text-xs text-gray-600 list-disc pl-5">
                    {l.selections.map((s, i) => (
                      <li key={i}>Grupo {s.groupId}: {s.optionItemIds.join(", ")}</li>
                    ))}
                  </ul>
                )}
                <div className="mt-2 flex items-center gap-2">
                  <span className="text-sm">Cantidad:</span>
                  <input type="number" min={1} className="border rounded p-1 w-20"
                         value={l.quantity}
                         onChange={(e)=>setQuantity(l.id, parseInt(e.target.value||"1"))} />
                </div>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between pt-4">
            <button className="text-sm text-red-600" onClick={clear}>Vaciar carrito</button>
            <Link href="/checkout" className="px-4 py-2 rounded bg-black text-white">Continuar</Link>
          </div>
        </>
      )}
    </main>
  );
}
