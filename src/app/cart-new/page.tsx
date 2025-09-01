'use client';
import CartViewNew from '@/components/cart-new/CartViewNew';

export default function CartNewPage() {
  return (
    <div className="container py-4">
      <h1 className="h4 mb-3">Carrito (nuevo)</h1>
      <CartViewNew />
    </div>
  );
}
