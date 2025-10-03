// src/app/account/page.tsx
"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { createUserWithEmailAndPassword, updateProfile } from "firebase/auth";
import { auth } from "@/lib/firebase/client";
import { useRouter } from "next/navigation";
import { useAuth } from "@/app/providers";

// 🔤 i18n
import { t as translate } from "@/lib/i18n/t";
import { useTenantSettings } from "@/lib/settings/hooks";

export default function AccountsRegisterPage() {
  const router = useRouter();
  const { user, loading } = useAuth();

  // idioma actual + helper
  const { settings } = useTenantSettings();
  const lang = useMemo(() => {
    try {
      if (typeof window !== "undefined") {
        const ls = localStorage.getItem("tenant.language");
        if (ls) return ls;
      }
    } catch {}
    return (settings as any)?.language;
  }, [settings]);
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

  useEffect(() => {
    if (!loading && user) router.replace("/");
  }, [loading, user, router]);

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

    setBusy(true);
    try {
      // 1) Create email+password account
      const cred = await createUserWithEmailAndPassword(auth, email.trim(), pass1);

      // 2) Update profile displayName
      await updateProfile(cred.user, { displayName: fullName.trim() });

      // 3) Force-refresh ID token
      const idToken = await cred.user.getIdToken(true);

      // 4) Initialize customers/{uid} (stores AUTH email server-side)
      try {
        await fetch("/api/customers/me", {
          method: "GET",
          headers: { Authorization: `Bearer ${idToken}` },
          cache: "no-store",
        });
      } catch {}

      // 5) Save profile fields & marketing preference
      try {
        await fetch("/api/customers/me", {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${idToken}`,
            "content-type": "application/json",
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
      router.replace("/");
    } catch (e: any) {
      setErr(tt("account.err.createFail", "The account could not be created. Please try again."));
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
