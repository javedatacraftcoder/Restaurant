// src/app/(client)/user-config/page.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import Protected from "@/components/Protected";
import { useAuth } from "@/app/providers";

// Firebase Auth (para cambiar contraseña)
import "@/lib/firebase/client";
import {
  getAuth,
  EmailAuthProvider,
  reauthenticateWithCredential,
  updatePassword,
} from "firebase/auth";

type Addr = {
  line1: string;
  city: string;
  country: string;
  zip: string;
  notes: string;
};

type Customer = {
  uid: string;
  email: string | null;
  displayName: string | null;
  phone: string | null;
  addresses: {
    home: Addr;
    office: Addr;
  };
  // ➕ Facturación (opcional)
  billing?: {
    name?: string;
    taxId?: string; // NIT
  };
};

type ApiGet = { ok?: boolean; error?: string; customer?: Customer };
type ApiPut = { ok?: boolean; error?: string; customer?: Customer };

// Helper mínimo: reintenta una vez si hay 401 forzando refresh del ID token
async function fetchWithRetryAuth(
  input: RequestInfo | URL,
  init: RequestInit,
  getFreshToken: () => Promise<string | null>
) {
  const res = await fetch(input, init);
  if (res.status !== 401) return res;

  const fresh = await getFreshToken();
  if (!fresh) return res;

  const nextInit: RequestInit = {
    ...init,
    headers: {
      ...(init.headers || {}),
      Authorization: `Bearer ${fresh}`,
    } as HeadersInit,
  };
  return fetch(input, nextInit);
}

function useCustomer() {
  const { idToken } = useAuth();
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [cust, setCust] = useState<Customer | null>(null);

  const headers: HeadersInit = useMemo(() => {
    const h: HeadersInit = { "Content-Type": "application/json" };
    if (idToken) (h as any).Authorization = `Bearer ${idToken}`;
    return h;
  }, [idToken]);

  const getFreshToken = async () => {
    try {
      const auth = getAuth();
      const u = auth.currentUser;
      if (!u) return null;
      const fresh = await u.getIdToken(true);
      return fresh || null;
    } catch {
      return null;
    }
  };

  const refresh = async () => {
    try {
      setErr(null);
      setLoading(true);
      const res = await fetchWithRetryAuth(
        "/api/customers/me",
        { headers, cache: "no-store" },
        getFreshToken
      );
      const data: ApiGet = await res.json().catch(() => ({} as any));
      if (!res.ok || data?.ok === false) throw new Error(data?.error || `HTTP ${res.status}`);
      setCust(data.customer || null);
    } catch (e: any) {
      setErr(e?.message || "Could not load profile");
      setCust(null);
    } finally {
      setLoading(false);
    }
  };

  const saveProfile = async (payload: { displayName?: string; phone?: string }) => {
    const res = await fetchWithRetryAuth(
      "/api/customers/me",
      {
        method: "PUT",
        headers,
        body: JSON.stringify(payload),
      },
      getFreshToken
    );
    const data: ApiPut = await res.json().catch(() => ({} as any));
    if (!res.ok || data?.ok === false) throw new Error(data?.error || `HTTP ${res.status}`);
    setCust(data.customer || null);
    return data.customer;
  };

  const saveAddresses = async (addresses: { home?: Partial<Addr>; office?: Partial<Addr> }) => {
    const res = await fetchWithRetryAuth(
      "/api/customers/me",
      {
        method: "PUT",
        headers,
        body: JSON.stringify({ addresses }),
      },
      getFreshToken
    );
    const data: ApiPut = await res.json().catch(() => ({} as any));
    if (!res.ok || data?.ok === false) throw new Error(data?.error || `HTTP ${res.status}`);
    setCust(data.customer || null);
    return data.customer;
  };

  // ➕ Guardar facturación
  const saveBilling = async (billing: { name?: string; taxId?: string }) => {
    const res = await fetchWithRetryAuth(
      "/api/customers/me",
      {
        method: "PUT",
        headers,
        body: JSON.stringify({ billing }),
      },
      getFreshToken
    );
    const data: ApiPut = await res.json().catch(() => ({} as any));
    if (!res.ok || data?.ok === false) throw new Error(data?.error || `HTTP ${res.status}`);
    setCust(data.customer || null);
    return data.customer;
  };

  useEffect(() => {
    if (!idToken) return;
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idToken]);

  return { loading, err, cust, refresh, saveProfile, saveAddresses, saveBilling } as const;
}

function UserConfigInner() {
  const { user } = useAuth();
  const { loading, err, cust, saveProfile, saveAddresses, saveBilling, refresh } = useCustomer();

  // Form state
  const [displayName, setDisplayName] = useState("");
  const [phone, setPhone] = useState("");
  const [home, setHome] = useState<Addr>({ line1: "", city: "", country: "", zip: "", notes: "" });
  const [office, setOffice] = useState<Addr>({ line1: "", city: "", country: "", zip: "", notes: "" });

  const [busyProfile, setBusyProfile] = useState(false);
  const [busyAddr, setBusyAddr] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  // ➕ Facturación
  const [billingName, setBillingName] = useState<string>("");
  const [billingTaxId, setBillingTaxId] = useState<string>("");
  const [busyBilling, setBusyBilling] = useState(false);

  // Password change
  const [currPass, setCurrPass] = useState("");
  const [newPass, setNewPass] = useState("");
  const [newPass2, setNewPass2] = useState("");
  const [busyPwd, setBusyPwd] = useState(false);
  const [currPassError, setCurrPassError] = useState<string | null>(null); // <- NUEVO: error inline del campo

  useEffect(() => {
    if (!cust) return;
    setDisplayName(cust.displayName || "");
    setPhone(cust.phone || "");
    setHome({
      line1: cust.addresses?.home?.line1 || "",
      city: cust.addresses?.home?.city || "",
      country: cust.addresses?.home?.country || "",
      zip: cust.addresses?.home?.zip || "",
      notes: cust.addresses?.home?.notes || "",
    });
    setOffice({
      line1: cust.addresses?.office?.line1 || "",
      city: cust.addresses?.office?.city || "",
      country: cust.addresses?.office?.country || "",
      zip: cust.addresses?.office?.zip || "",
      notes: cust.addresses?.office?.notes || "",
    });
    // ➕ Precargar facturación si existe
    setBillingName(cust.billing?.name || "");
    setBillingTaxId(cust.billing?.taxId || "");
  }, [cust]);

  const onSaveProfile = async () => {
    try {
      setErrMsg(null);
      setMsg(null);
      setBusyProfile(true);
      await saveProfile({ displayName, phone });
      setMsg("Profile updated");
    } catch (e: any) {
      setErrMsg(e?.message || "Could not save profile");
    } finally {
      setBusyProfile(false);
    }
  };

  const onSaveAddresses = async () => {
    try {
      setErrMsg(null);
      setMsg(null);
      setBusyAddr(true);
      await saveAddresses({ home, office });
      setMsg("Addresses saved");
    } catch (e: any) {
      setErrMsg(e?.message || "Could not save addresses");
    } finally {
      setBusyAddr(false);
    }
  };

  // ➕ Guardar facturación
  const onSaveBilling = async () => {
    try {
      setErrMsg(null);
      setMsg(null);
      setBusyBilling(true);
      await saveBilling({ name: billingName, taxId: billingTaxId });
      setMsg("Billing details saved");
    } catch (e: any) {
      setErrMsg(e?.message || "Could not save billing details");
    } finally {
      setBusyBilling(false);
    }
  };

  const onChangePassword = async () => {
    try {
      setErrMsg(null);
      setMsg(null);
      setCurrPassError(null); // limpiar error inline antes de validar

      if (!user?.email) {
        setErrMsg("There's no email in the current session");
        return;
      }
      if (!currPass) {
        setCurrPassError("Enter your current password");
        return;
      }
      if (!newPass || newPass.length < 6) {
        setErrMsg("New password must be at least 6 characters");
        return;
      }
      if (newPass !== newPass2) {
        setErrMsg("Password confirmation doesn't match");
        return;
      }

      setBusyPwd(true);

      const auth = getAuth();
      const cred = EmailAuthProvider.credential(user.email, currPass);

      // Reautenticación obligatoria
      await reauthenticateWithCredential(auth.currentUser!, cred);
      await updatePassword(auth.currentUser!, newPass);

      setMsg("Password updated successfully");
      setCurrPass("");
      setNewPass("");
      setNewPass2("");
      setCurrPassError(null);
    } catch (e: any) {
      // Manejo fino según código de Firebase
      const code: string = e?.code || "";
      if (code === "auth/wrong-password" || code === "auth/invalid-credential") {
      // Marcar solo el campo de contraseña actual en rojo, sin alert global
        setCurrPassError("Incorrect current password");
      } else if (code === "auth/too-many-requests") {
        setCurrPassError("Too many attempts. Try again later.");
      } else if (code === "auth/requires-recent-login") {
        setErrMsg("For security, sign in again and try again.");
      } else {
        setErrMsg(e?.message || "Could not update password");
      }
    } finally {
      setBusyPwd(false);
    }
  };

  return (
    <div className="container py-4">
      <div className="d-flex align-items-center justify-content-between mb-3">
        <h1 className="h5 m-0">User settings</h1>
        <button className="btn btn-outline-secondary btn-sm" onClick={() => refresh()} disabled={loading}>
          Refresh
        </button>
      </div>

      {loading && <div className="alert alert-info">Loading…</div>}
      {err && <div className="alert alert-danger">Error: {err}</div>}
      {msg && <div className="alert alert-success">{msg}</div>}
      {/* En errores de contraseña por "wrong password" ya no usamos este alert. */}
      {errMsg && <div className="alert alert-danger">{errMsg}</div>}

      {!!cust && (
        <>
          {/* PERFIL */}
          <section className="mb-4">
            <div className="card shadow-sm">
              <div className="card-header">
                <strong>Profile</strong>
              </div>
              <div className="card-body">
                <div className="row g-3">
                  <div className="col-12 col-md-6">
                    <label className="form-label">Email (read-only)</label>
                    <input className="form-control" value={cust.email || ""} disabled />
                  </div>
                  <div className="col-12 col-md-6">
                    <label className="form-label">Display name</label>
                    <input
                      className="form-control"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      placeholder="Your name"
                    />
                  </div>
                  <div className="col-12 col-md-6">
                    <label className="form-label">Phone</label>
                    <input
                      className="form-control"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="+502 5555-5555"
                    />
                  </div>
                </div>
              </div>
              <div className="card-footer d-flex justify-content-end">
                <button className="btn btn-primary" onClick={onSaveProfile} disabled={busyProfile}>
                  {busyProfile ? "Saving…" : "Save profile"}
                </button>
              </div>
            </div>
          </section>

          {/* DIRECCIONES */}
          <section className="mb-4">
            <div className="card shadow-sm">
              <div className="card-header">
                <strong>Addresses</strong>
              </div>
              <div className="card-body">
                <div className="row">
                  {/* HOME */}
                  <div className="col-12 col-lg-6">
                    <h6 className="mb-3">Home</h6>
                    <div className="mb-2">
                      <label className="form-label">Address</label>
                      <input
                        className="form-control"
                        value={home.line1}
                        onChange={(e) => setHome({ ...home, line1: e.target.value })}
                        placeholder="Street/Avenue, number, reference"
                      />
                    </div>
                    <div className="row g-2">
                      <div className="col-12 col-md-6">
                        <label className="form-label">City</label>
                        <input
                          className="form-control"
                          value={home.city}
                          onChange={(e) => setHome({ ...home, city: e.target.value })}
                          placeholder="Guatemala"
                        />
                      </div>
                      <div className="col-6 col-md-3">
                        <label className="form-label">Country</label>
                        <input
                          className="form-control"
                          value={home.country}
                          onChange={(e) => setHome({ ...home, country: e.target.value })}
                          placeholder="GT"
                        />
                      </div>
                      <div className="col-6 col-md-3">
                        <label className="form-label">ZIP</label>
                        <input
                          className="form-control"
                          value={home.zip}
                          onChange={(e) => setHome({ ...home, zip: e.target.value })}
                          placeholder="01010"
                        />
                      </div>
                    </div>
                    <div className="mt-2">
                      <label className="form-label">Additional directions</label>
                      <textarea
                        className="form-control"
                        rows={2}
                        value={home.notes}
                        onChange={(e) => setHome({ ...home, notes: e.target.value })}
                        placeholder="Delivery details"
                      />
                    </div>
                  </div>

                  {/* OFFICE */}
                  <div className="col-12 col-lg-6 mt-4 mt-lg-0">
                    <h6 className="mb-3">Office</h6>
                    <div className="mb-2">
                      <label className="form-label">Address</label>
                      <input
                        className="form-control"
                        value={office.line1}
                        onChange={(e) => setOffice({ ...office, line1: e.target.value })}
                        placeholder="Building, floor, office"
                      />
                    </div>
                    <div className="row g-2">
                      <div className="col-12 col-md-6">
                        <label className="form-label">City</label>
                        <input
                          className="form-control"
                          value={office.city}
                          onChange={(e) => setOffice({ ...office, city: e.target.value })}
                          placeholder="Guatemala"
                        />
                      </div>
                      <div className="col-6 col-md-3">
                        <label className="form-label">Country</label>
                        <input
                          className="form-control"
                          value={office.country}
                          onChange={(e) => setOffice({ ...office, country: e.target.value })}
                          placeholder="GT"
                        />
                      </div>
                      <div className="col-6 col-md-3">
                        <label className="form-label">ZIP</label>
                        <input
                          className="form-control"
                          value={office.zip}
                          onChange={(e) => setOffice({ ...office, zip: e.target.value })}
                          placeholder="01010"
                        />
                      </div>
                    </div>
                    <div className="mt-2">
                      <label className="form-label">Additional directions</label>
                      <textarea
                        className="form-control"
                        rows={2}
                        value={office.notes}
                        onChange={(e) => setOffice({ ...office, notes: e.target.value })}
                        placeholder="Reception, hours, etc."
                      />
                    </div>
                  </div>
                </div>
              </div>
              <div className="card-footer d-flex justify-content-end">
                <button className="btn btn-primary" onClick={onSaveAddresses} disabled={busyAddr}>
                  {busyAddr ? "Saving…" : "Save addresses"}
                </button>
              </div>
            </div>
          </section>

          {/* ➕ FACTURACIÓN */}
          <section className="mb-4">
            <div className="card shadow-sm">
              <div className="card-header">
                <strong>Billing</strong>
              </div>
              <div className="card-body">
                <div className="row g-3">
                  <div className="col-12 col-md-6">
                    <label className="form-label">Billing name</label>
                    <input
                      className="form-control"
                      value={billingName}
                      onChange={(e) => setBillingName(e.target.value)}
                      placeholder="Business name / Billing name"
                    />
                  </div>
                  <div className="col-12 col-md-6">
                    <label className="form-label">Tax Identification Number (NIT)</label>
                    <input
                      className="form-control"
                      value={billingTaxId}
                      onChange={(e) => setBillingTaxId(e.target.value)}
                      placeholder="e.g., CF / 1234567-8"
                    />
                  </div>
                </div>
              </div>
              <div className="card-footer d-flex justify-content-end">
                <button className="btn btn-primary" onClick={onSaveBilling} disabled={busyBilling}>
                  {busyBilling ? "Saving…" : "Save billing"}
                </button>
              </div>
            </div>
          </section>

          {/* SEGURIDAD */}
          <section className="mb-4">
            <div className="card shadow-sm">
              <div className="card-header">
                <strong>Security</strong> <span className="text-muted small ms-2">(change password)</span>
              </div>
              <div className="card-body">
                <div className="row g-3">
                  <div className="col-12 col-md-4">
                    <label className="form-label">Current password</label>
                    <input
                      type="password"
                      className={`form-control ${currPassError ? "is-invalid" : ""}`}
                      value={currPass}
                      onChange={(e) => {
                        setCurrPass(e.target.value);
                        if (currPassError) setCurrPassError(null); // limpiar al teclear
                      }}
                      placeholder="••••••••"
                      autoComplete="current-password"
                    />
                    {currPassError && (
                      <div className="invalid-feedback">
                        {currPassError}
                      </div>
                    )}
                  </div>
                  <div className="col-12 col-md-4">
                    <label className="form-label">New password</label>
                    <input
                      type="password"
                      className="form-control"
                      value={newPass}
                      onChange={(e) => setNewPass(e.target.value)}
                      placeholder="••••••••"
                      autoComplete="new-password"
                    />
                  </div>
                  <div className="col-12 col-md-4">
                    <label className="form-label">Confirm new password</label>
                    <input
                      type="password"
                      className="form-control"
                      value={newPass2}
                      onChange={(e) => setNewPass2(e.target.value)}
                      placeholder="••••••••"
                      autoComplete="new-password"
                    />
                  </div>
                </div>
              </div>
              <div className="card-footer d-flex justify-content-end">
                <button className="btn btn-outline-primary" onClick={onChangePassword} disabled={busyPwd}>
                  {busyPwd ? "Updating…" : "Update password"}
                </button>
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

export default function UserConfigPage() {
  return (
    <Protected>
      <UserConfigInner />
    </Protected>
  );
}
