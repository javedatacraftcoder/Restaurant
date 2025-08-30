// src/app/menu/layout.tsx
import type { ReactNode } from "react";
import ClientAppLayout from "@/app/(client)/app/layout";

export default function MenuLayout({ children }: { children: ReactNode }) {
  return <ClientAppLayout>{children}</ClientAppLayout>;
}
