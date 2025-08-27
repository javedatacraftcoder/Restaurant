// src/app/cart/CartContext.tsx
export {
  CartProvider,
  useCart,
  buildQuotePayload,
} from "@/lib/cart/context";

export type {
  CartState,
  CartLine,
  CartOptionSel,
} from "@/lib/cart/context";
