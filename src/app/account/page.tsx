// src/app/account/page.tsx
"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { createUserWithEmailAndPassword, updateProfile } from "firebase/auth";
import { auth } from "@/lib/firebase/client";
import { useRouter } from "next/navigation";
import { useAuth } from "@/app/providers";

// 🔤 i18n
import { t as translate } from "@/lib/i18n/t";
import { useTenantSettings } from "@/lib/settings/hooks";

// ✅ Turnstile (mismo patrón que admin/ai-studio)
import TurnstileWidget, { TurnstileWidgetHandle } from "@/components/TurnstileWidget";
const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || "";

export default function AccountsRegisterPage() {
  const router = useRouter();
  const { user, loading } = useAuth();

  // ===== Idioma estable: inicializa con settings (SSR) y sincroniza localStorage tras mount =====
  const { settings } = useTenantSettings();
  const initialLang = (settings as any)?.language;
  const [lang, setLang] = useState<string | undefined>(initialLang);
  useEffect(() => {
    try {
      const ls = localStorage.getItem("tenant.language");
      if (ls && ls !== initialLang) setLang(ls);
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const tt = (key: string, fallback: string, vars?: Record<string, unknown>) => {
    const s = translate(lang, key, vars);
    return s === key ? fallback : s;
  };

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [pass1, setPass1] = useState("");
  const [pass2, setPass2] = useState("");

  // Required acknowledgement + optional marketing opt-in
  const [ackMarketing, setAckMarketing] = useState(false);
  const [marketingOptIn, setMarketingOptIn] = useState(false);

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // ✅ CAPTCHA (idéntico enfoque que admin/ai-studio)
  const [captchaToken, setCaptchaToken] = useState<string>("");
  const tRef = useRef<TurnstileWidgetHandle | null>(null);

  useEffect(() => {
    if (!loading && user) router.replace("/app");
  }, [loading, user, router]);

  // === Helper: obtener token fresco (reset + polling corto) ===
  async function getFreshCaptchaToken(maxMs = 2500): Promise<string> {
    const started = Date.now();
    // intenta leer el token actual del widget
    let token = tRef.current?.getToken() || "";
    if (token) return token;

    // resetea y espera a que emita un token
    tRef.current?.reset();
    while (!token && Date.now() - started < maxMs) {
      await new Promise((r) => setTimeout(r, 200));
      token = tRef.current?.getToken() || "";
    }
    return token;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErr(null);

    if (!ackMarketing) {
      setErr(tt("account.err.ack", "Please acknowledge the marketing notice to continue."));
      return;
    }
    if (fullName.trim().length < 2) {
      setErr(tt("account.err.name", "Please enter your full name."));
      return;
    }
    if (!email.trim() || !email.includes("@")) {
      setErr(tt("account.err.email", "Please enter a valid email address."));
      return;
    }
    if (pass1 !== pass2) {
      setErr(tt("account.err.pass.match", "Passwords do not match."));
      return;
    }
    if (pass1.length < 6) {
      setErr(tt("account.err.pass.min", "Password must be at least 6 characters long."));
      return;
    }

    // ✅ Exigir token Turnstile (como en admin/ai-studio)
    let token = await getFreshCaptchaToken();
    if (!token) {
      tRef.current?.reset();
      token = await getFreshCaptchaToken();
    }
    if (!token) {
      setErr(tt("account.err.captcha", "Please complete the CAPTCHA to continue."));
      return;
    }

    setBusy(true);
    try {
      // 1) Create email+password account
      const cred = await createUserWithEmailAndPassword(auth, email.trim(), pass1);

      // 2) Update profile displayName
      await updateProfile(cred.user, { displayName: fullName.trim() });

      // 3) Force-refresh ID token
      const idToken = await cred.user.getIdToken(true);

      // 4) Initialize customers/{uid}
      try {
        await fetch("/api/customers/me", {
          method: "GET",
          headers: { Authorization: `Bearer ${idToken}` },
          cache: "no-store",
        });
      } catch {}

      // 5) Save profile fields & marketing preference (manda token Turnstile para verificación server-side)
      try {
        await fetch("/api/customers/me", {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${idToken}`,
            "content-type": "application/json",
            "x-turnstile-token": token, // si tu backend espera x-captcha-token, cámbialo aquí
          },
          body: JSON.stringify({
            displayName: fullName.trim(),
            marketingOptIn,
          }),
        });
      } catch {}

      // 6) Send welcome email (idempotent on server)
      try {
        await fetch("/api/tx/welcome", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${idToken}`,
            "content-type": "application/json",
          },
        });
      } catch {}

      // 7) Redirect
      router.replace("/app");
    } catch (e: any) {
      setErr(tt("account.err.createFail", "The account could not be created. Please try again."));
      try { tRef.current?.reset(); } catch {}
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="container py-4" style={{ maxWidth: 520 }}>
      <h1 className="h3 mb-3 text-center">{tt("account.title", "Create account")}</h1>

      <form onSubmit={onSubmit} className="card p-3 border-0 shadow-sm">
        <div className="mb-3">
          <label className="form-label">{tt("account.fullName.label", "Full name")}</label>
          <input
            className="form-control"
            type="text"
            placeholder={tt("account.fullName.placeholder", "John Doe")}
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            required
            disabled={busy}
          />
        </div>

        <div className="mb-3">
          <label className="form-label">{tt("account.email.label", "Email")}</label>
          <input
            className="form-control"
            type="email"
            autoComplete="email"
            placeholder={tt("account.email.placeholder", "you@example.com")}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            disabled={busy}
          />
        </div>

        <div className="mb-3">
          <label className="form-label">{tt("account.password.label", "Password")}</label>
          <input
            className="form-control"
            type="password"
            autoComplete="new-password"
            placeholder={tt("account.password.placeholder", "Minimum 6 characters")}
            value={pass1}
            onChange={(e) => setPass1(e.target.value)}
            required
            disabled={busy}
            minLength={6}
          />
        </div>

        <div className="mb-3">
          <label className="form-label">{tt("account.confirm.label", "Confirm password")}</label>
          <input
            className="form-control"
            type="password"
            autoComplete="new-password"
            placeholder={tt("account.confirm.placeholder", "Re-enter your password")}
            value={pass2}
            onChange={(e) => setPass2(e.target.value)}
            required
            disabled={busy}
            minLength={6}
          />
        </div>

        {/* REQUIRED acknowledgement */}
        <div className="form-check mb-2">
          <input
            className="form-check-input"
            type="checkbox"
            id="ackMarketing"
            checked={ackMarketing}
            onChange={(e) => setAckMarketing(e.target.checked)}
            disabled={busy}
            required
          />
          <label className="form-check-label" htmlFor="ackMarketing">
            {tt(
              "account.ack.label",
              "I understand that my email may be used for marketing communications if I opt in."
            )}
          </label>
        </div>

        {/* OPTIONAL opt-in */}
        <div className="form-check form-switch mb-1">
          <input
            className="form-check-input"
            type="checkbox"
            id="optInSwitch"
            checked={marketingOptIn}
            onChange={(e) => setMarketingOptIn(e.target.checked)}
            disabled={busy}
          />
          <label className="form-check-label" htmlFor="optInSwitch">
            {tt("account.optin.label", "Send me promotions and special offers.")}
          </label>
        </div>
        <p className="text-muted small mb-3">
          {tt("account.optin.note", "You can unsubscribe at any time using the links in our emails.")}
        </p>

        {/* ✅ CAPTCHA (idéntico a admin: widget + ref + onToken) */}
        <div className="mb-3">
          {TURNSTILE_SITE_KEY ? (
            <TurnstileWidget ref={tRef} siteKey={TURNSTILE_SITE_KEY} onToken={setCaptchaToken} />
          ) : (
            <div className="alert alert-warning py-2">
              {tt("admin.aistudio.turnstileMissing", "Missing")} <code>NEXT_PUBLIC_TURNSTILE_SITE_KEY</code> {tt("admin.aistudio.envVar", "env var.")}
            </div>
          )}
        </div>

        <button className="btn btn-success w-100" disabled={busy}>
          {busy ? tt("account.submit.creating", "Creating...") : tt("account.submit.create", "Create account")}
        </button>

        {err && <p className="text-danger mt-3 mb-0">{err}</p>}
      </form>

      <p className="text-center mt-3 mb-0">
        {tt("account.footer.have", "Already have an account?")}{" "}
        <a href="/login" className="link-primary">{tt("account.footer.signin", "Sign in")}</a>
      </p>
    </main>
  );
}
