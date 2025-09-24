//src/app/admin/settings/page.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import Protected from "@/components/Protected";
import AdminOnly from "@/components/AdminOnly";
import "@/lib/firebase/client";
import { useTenantSettings } from "@/lib/settings/hooks";
import { writeGeneralSettings } from "@/lib/settings/storage";

// Opciones comunes (puedes ampliar)
const CURRENCIES = [
  { code: "USD", label: "USD — US Dollar" },
  { code: "GTQ", label: "GTQ — Quetzal (Guatemala)" },
  { code: "MXN", label: "MXN — Peso mexicano" },
  { code: "EUR", label: "EUR — Euro" },
  { code: "COP", label: "COP — Peso colombiano" },
  { code: "ARS", label: "ARS — Peso argentino" },
  { code: "PEN", label: "PEN — Sol peruano" },
  { code: "CLP", label: "CLP — Peso chileno" },
];

const LOCALES = [
  { code: "es-GT", label: "Español (Guatemala)" },
  { code: "es-MX", label: "Español (México)" },
  { code: "es-ES", label: "Español (España)" },
  { code: "en-US", label: "English (United States)" },
  { code: "en-GB", label: "English (United Kingdom)" },
  { code: "pt-BR", label: "Português (Brasil)" },
  { code: "fr-FR", label: "Français (France)" },
];

// 🔥 NUEVO: Opciones de idioma (para textos del cliente)
const LANGUAGES = [
  { code: "es", label: "Español" },
  { code: "en", label: "English" },
  { code: "pt", label: "Português" },
  { code: "fr", label: "Français" },
];

export default function AdminSettingsPage() {
  const { settings, loading, error, fmtCurrency, reload } = useTenantSettings();

  const [currency, setCurrency] = useState<string>("USD");
  const [locale, setLocale] = useState<string>("en-US");
  const [uiLanguage, setUiLanguage] = useState<string>("es"); // ✅ corregido

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<null | "ok" | "err">(null);

  useEffect(() => {
    if (settings) {
      setCurrency(settings.currency || "USD");
      setLocale(settings.currencyLocale || "en-US");
      setUiLanguage((settings as any).language || "es"); // ✅ cast a any
    }
  }, [settings]);

  const example = useMemo(() => fmtCurrency(1234.56), [fmtCurrency]);

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaved(null);
    try {
      await writeGeneralSettings({ 
        currency, 
        currencyLocale: locale, 
        language: uiLanguage, // ✅ guardar como language en Firestore
      } as any); // ✅ cast a any
      if (typeof window !== "undefined") localStorage.setItem("tenant.language", uiLanguage);

      await reload();
      setSaved("ok");
    } catch (e) {
      console.error(e);
      setSaved("err");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Protected>
      <AdminOnly>
        <main className="container py-4">
          <h1 className="mb-3">⚙️ Configuración General</h1>
          <p className="text-muted mb-4">
            Ajusta el <strong>currency</strong>, el <strong>locale</strong> y el{" "}
            <strong>idioma</strong> del área cliente.
          </p>

          {loading && <div className="alert alert-info">Cargando configuración…</div>}
          {error && <div className="alert alert-danger">Error: {error}</div>}

          {!loading && (
            <form className="card p-3 shadow-sm" onSubmit={onSave}>
              <div className="row gy-3">
                {/* Currency */}
                <div className="col-12 col-md-4">
                  <label className="form-label fw-semibold">Moneda (ISO)</label>
                  <select
                    className="form-select"
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value)}
                  >
                    {CURRENCIES.map((c) => (
                      <option key={c.code} value={c.code}>{c.label}</option>
                    ))}
                  </select>
                  <div className="form-text">
                    Afecta el símbolo y reglas monetarias. Ej.: {fmtCurrency(1500)}
                  </div>
                </div>

                {/* Locale */}
                <div className="col-12 col-md-4">
                  <label className="form-label fw-semibold">Locale</label>
                  <select
                    className="form-select"
                    value={locale}
                    onChange={(e) => setLocale(e.target.value)}
                  >
                    {LOCALES.map((l) => (
                      <option key={l.code} value={l.code}>{l.label}</option>
                    ))}
                  </select>
                  <div className="form-text">
                    Afecta separadores, orden y formato. Ej.:{" "}
                    {new Intl.NumberFormat(locale, { style: "currency", currency }).format(1500)}
                  </div>
                </div>

                {/* Language */}
                <div className="col-12 col-md-4">
                  <label className="form-label fw-semibold">Idioma (área cliente)</label>
                  <select
                    className="form-select"
                    value={uiLanguage}
                    onChange={(e) => setUiLanguage(e.target.value)}
                  >
                    {LANGUAGES.map((l) => (
                      <option key={l.code} value={l.code}>{l.label}</option>
                    ))}
                  </select>
                  <div className="form-text">
                    Define el idioma de la interfaz que verán los clientes.
                  </div>
                </div>
              </div>

              <hr className="my-4" />

              <div className="d-flex align-items-center gap-3">
                <button className="btn btn-primary" disabled={saving}>
                  {saving ? "Guardando…" : "Guardar cambios"}
                </button>
                {saved === "ok" && <span className="text-success">✅ Guardado</span>}
                {saved === "err" && <span className="text-danger">❌ Error al guardar</span>}
              </div>

              <div className="mt-4">
                <span className="badge text-bg-light">
                  Vista previa moneda: <strong>{example}</strong>
                </span>
              </div>
            </form>
          )}
        </main>
      </AdminOnly>
    </Protected>
  );
}
