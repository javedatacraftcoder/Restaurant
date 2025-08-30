// src/app/checkout/layout.tsx
import type { ReactNode } from "react";
import ClientAppLayout from "@/app/(client)/app/layout";

export default function CheckoutLayout({ children }: { children: ReactNode }) {
  return <ClientAppLayout>{children}</ClientAppLayout>;
}
