"use client";

import Link from "next/link";
// Usa el MISMO hook del provider real:
import { useCart } from "@/lib/cart/context"; // <-- importante

export default function CartBadge({ href = "/cart" }: { href?: string }) {
  const { cart } = useCart();
  const items = cart.lines.reduce((sum, l) => sum + (l.quantity || 0), 0);

  return (
    <Link
      href={href}
      style={{
        textDecoration: "none",
        color: "inherit",
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 8px",
        borderRadius: 8,
        border: "1px solid #e5e7eb",
      }}
      title="Ver carrito"
    >
      <span>🛒</span>
      <span>{items}</span>
    </Link>
  );
}
