// src/lib/i18n/t.ts
import { MESSAGES } from "./messages";

/** Normaliza 'en-US', 'es-GT' -> 'en', 'es' y valida que exista en MESSAGES */
export function getLang(raw?: string): keyof typeof MESSAGES {
  const lc = (raw || "es").toLowerCase();
  const short = lc.split("-")[0] as keyof typeof MESSAGES; // "en-US" -> "en"
  return (short in MESSAGES ? short : "es");
}

/** Traduce por clave con fallback a la propia clave si no existe */
export function t(rawLang: string | undefined, key: string): string {
  const lang = getLang(rawLang);
  return MESSAGES[lang]?.[key] ?? key;
}
