// src/app/admin/marketing/page.tsx
'use client';

import React, { useEffect, useState } from 'react';
import Protected from '@/components/Protected';
import AdminOnly from '@/components/AdminOnly';
import { useAuth } from '@/app/providers';

export default function AdminMarketingPage() {
  const { idToken, loading } = useAuth();
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [subject, setSubject] = useState('');
  const [html, setHtml] = useState('<h1>Hola 👋</h1><p>Este es un ejemplo de campaña.</p>');
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [testEmail, setTestEmail] = useState('');
  const [includeAllCustomers, setIncludeAllCustomers] = useState(false);

  const hasAuth = !!idToken && !loading;

  async function call(path: string, opts?: RequestInit) {
    if (!idToken) throw new Error('Missing idToken');
    const res = await fetch(path, {
      ...opts,
      headers: {
        ...(opts?.headers || {}),
        'Authorization': `Bearer ${idToken}`,
        'content-type': 'application/json',
      },
    });
    const jr = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(jr?.error || 'Request error');
    return jr;
  }

  async function onSetup() {
    setBusy(true);
    setLog(l => [...l, 'Setup…']);
    try {
      const r = await call('/api/marketing/brevo/setup', { method: 'POST' });
      setLog(l => [...l, `OK: listId=${r?.config?.listId}`]);
    } catch (e: any) {
      setLog(l => [...l, `Error: ${e?.message || e}`]);
    } finally {
      setBusy(false);
    }
  }

  async function onSyncCustomers() {
    setBusy(true);
    setLog(l => [...l, `Sync customers (includeAll=${includeAllCustomers})…`]);
    try {
      const r = await call(`/api/marketing/brevo/sync-contacts?includeAll=${includeAllCustomers ? '1' : '0'}`, { method: 'POST' });
      setLog(l => [...l, `Customers → Brevo OK: total=${r?.total} created=${r?.created} updated=${r?.updated} failed=${r?.failed?.length} (skippedNoEmail=${r?.skippedNoEmail}, skippedNoOptin=${r?.skippedNoOptin})`]);
    } catch (e: any) {
      setLog(l => [...l, `Error: ${e?.message || e}`]);
    } finally {
      setBusy(false);
    }
  }

  async function onSyncAuthUsers() {
    setBusy(true);
    setLog(l => [...l, 'Sync Firebase Auth…']);
    try {
      const r = await call('/api/marketing/brevo/sync-auth-users', { method: 'POST' });
      setLog(l => [...l, `Auth → Brevo OK: total=${r?.total} created=${r?.created} updated=${r?.updated} failed=${r?.failed?.length}`]);
    } catch (e: any) {
      setLog(l => [...l, `Error: ${e?.message || e}`]);
    } finally {
      setBusy(false);
    }
  }

  async function onSyncAll() {
    setBusy(true);
    setLog(l => [...l, `Sync ALL (Auth + Customers; includeFirestoreAll=${includeAllCustomers})…`]);
    try {
      const r = await call(`/api/marketing/brevo/sync-all?includeFirestoreAll=${includeAllCustomers ? '1' : '0'}`, { method: 'POST' });
      setLog(l => [...l, `ALL → Brevo OK: total=${r?.total} created=${r?.created} updated=${r?.updated} failed=${r?.failed?.length} (auth=${r?.sourceCounts?.auth}, customers=${r?.sourceCounts?.customers})`]);
    } catch (e: any) {
      setLog(l => [...l, `Error: ${e?.message || e}`]);
    } finally {
      setBusy(false);
    }
  }

  async function onCreateCampaign() {
    setBusy(true);
    try {
      const r = await call('/api/marketing/brevo/campaigns', { method: 'POST', body: JSON.stringify({ subject, html }) });
      setLog(l => [...l, `Campaign created: id=${r?.campaign?.id}`]);
      await refreshCampaigns();
    } catch (e: any) {
      setLog(l => [...l, `Error: ${e?.message || e}`]);
    } finally {
      setBusy(false);
    }
  }

  async function onSendNow(id: number) {
    setBusy(true);
    try {
      await call(`/api/marketing/brevo/campaigns/${id}/send-now`, { method: 'POST' });
      setLog(l => [...l, `Campaign sent ${id}`]);
      await refreshCampaigns();
    } catch (e: any) {
      setLog(l => [...l, `Error: ${e?.message || e}`]);
    } finally {
      setBusy(false);
    }
  }

  async function onSendTest(id: number) {
    if (!testEmail) { alert('Enter email for test.'); return; }
    setBusy(true);
    try {
      await call(`/api/marketing/brevo/campaigns/${id}/send-test`, { method: 'POST', body: JSON.stringify({ emailTo: [testEmail] }) });
      setLog(l => [...l, `Test sent to ${testEmail}`]);
    } catch (e: any) {
      setLog(l => [...l, `Error: ${e?.message || e}`]);
    } finally {
      setBusy(false);
    }
  }

  async function refreshCampaigns() {
    try {
      const r = await call('/api/marketing/brevo/campaigns', { method: 'GET' });
      setCampaigns(r?.campaigns || []);
    } catch {}
  }

  useEffect(() => {
    if (hasAuth) refreshCampaigns();
  }, [hasAuth]);

  return (
    <Protected>
      <AdminOnly>
        <main className="container py-4">
          <div className="d-flex align-items-center justify-content-between mb-3">
            <h1 className="h4 m-0">Marketing (Brevo)</h1>
            <div className="d-flex flex-wrap gap-2 align-items-center">
              <div className="form-check form-switch me-2">
                <input className="form-check-input" type="checkbox" role="switch" id="incAll"
                  checked={includeAllCustomers} onChange={e => setIncludeAllCustomers(e.target.checked)} />
                <label className="form-check-label small" htmlFor="incAll">Include all customers</label>
              </div>
              <button className="btn btn-outline-secondary btn-sm" onClick={onSetup} disabled={!hasAuth || busy}>Setup</button>
              <button className="btn btn-outline-primary btn-sm" onClick={onSyncCustomers} disabled={!hasAuth || busy}>Sync customers</button>
              <button className="btn btn-outline-primary btn-sm" onClick={onSyncAuthUsers} disabled={!hasAuth || busy}>Sync Auth users</button>
              <button className="btn btn-primary btn-sm" onClick={onSyncAll} disabled={!hasAuth || busy}>Sync ALL</button>
            </div>
          </div>

          {/* Compose */}
          <div className="card mb-4">
            <div className="card-header">New campaign</div>
            <div className="card-body">
              <div className="mb-3">
                <label className="form-label">Subject</label>
                <input className="form-control" value={subject} onChange={e => setSubject(e.target.value)} placeholder="Ej. Promociones del fin de semana" />
              </div>
              <div className="mb-3">
                <label className="form-label">HTML</label>
                <textarea className="form-control" rows={8} value={html} onChange={e => setHtml(e.target.value)} />
                <div className="form-text">Include your branding and a clear message. (Brevo will add unsubscribe management)</div>
              </div>
              <div className="d-flex gap-2">
                <button className="btn btn-success" onClick={onCreateCampaign} disabled={!hasAuth || busy || !subject || !html}>Crear campaña</button>
              </div>
            </div>
          </div>

          {/* Campaigns list */}
          <div className="card">
            <div className="card-header">Recent campaigns</div>
            <div className="card-body">
              <div className="row g-3">
                <div className="col-12 col-md-6">
                  <label className="form-label">Send test to</label>
                  <div className="input-group">
                    <input className="form-control" placeholder="correo@ejemplo.com" value={testEmail} onChange={e => setTestEmail(e.target.value)} />
                    <span className="input-group-text">@</span>
                  </div>
                </div>
              </div>
              <div className="table-responsive mt-3">
                <table className="table table-sm align-middle">
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>Name</th>
                      <th>Subject</th>
                      <th>Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {campaigns.length === 0 && (
                      <tr><td colSpan={5} className="text-muted">No campaigns…</td></tr>
                    )}
                    {campaigns.map((c: any) => (
                      <tr key={c.id}>
                        <td>{c.id}</td>
                        <td>{c.name}</td>
                        <td>{c.subject}</td>
                        <td>{c.status}</td>
                        <td className="d-flex gap-2">
                          <button className="btn btn-outline-secondary btn-sm" onClick={() => onSendTest(c.id)} disabled={!hasAuth || busy || !testEmail}>Test</button>
                          <button className="btn btn-primary btn-sm" onClick={() => onSendNow(c.id)} disabled={!hasAuth || busy}>Enviar ahora</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Log */}
          <div className="mt-4">
            <h2 className="h6">Register</h2>
            <pre className="bg-light p-3 rounded small" style={{ maxHeight: 200, overflow: 'auto' }}>
              {log.join('\n') || '...'}
            </pre>
          </div>
        </main>
      </AdminOnly>
    </Protected>
  );
}
