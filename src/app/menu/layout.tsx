// src/app/menu/layout.tsx
import type { ReactNode } from "react";
import ClientAppLayout from "@/app/(client)/app/layout";
import { db } from "@/lib/firebase/admin";

// Resuelve el idioma en el servidor desde tu settings (mismo origen que ya usas)
async function getUiLanguage(): Promise<string> {
  try {
    const s = await db.collection("settings").doc("general").get();
    const lang = (s.exists && (s.data() as any)?.language) || "es";
    return typeof lang === "string" ? lang : "es";
  } catch {
    return "es";
  }
}

export default async function MenuLayout({ children }: { children: ReactNode }) {
  const serverLang = await getUiLanguage();
  return <ClientAppLayout serverLang={serverLang}>{children}</ClientAppLayout>;
}
