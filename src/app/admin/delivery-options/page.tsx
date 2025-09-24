// src/app/admin/delivery-options/page.tsx
'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  getFirestore,
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  serverTimestamp,
  onSnapshot,
  query,
  orderBy,
} from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { useFmtQ } from '@/lib/settings/money'; // ✅ usar formateador global

type DeliveryOption = {
  id: string;
  title: string;
  description?: string;
  price: number;       // en unidades (no centavos)
  isActive: boolean;
  sortOrder?: number;
  createdAt?: any;
  updatedAt?: any;
};

export default function AdminDeliveryOptionsPage() {
  const db = getFirestore();
  const [list, setList] = useState<DeliveryOption[]>([]);
  const [loading, setLoading] = useState(true);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState<number>(0);
  const [isActive, setIsActive] = useState<boolean>(true);
  const [sortOrder, setSortOrder] = useState<number>(0);

  // ✅ formateador centralizado (por si lo necesitas mostrar en algún label)
  const fmtQ = useFmtQ();

  useEffect(() => {
    const qRef = query(collection(db, 'deliveryOptions'), orderBy('sortOrder', 'asc'));
    const unsub = onSnapshot(qRef, (snap) => {
      const arr: DeliveryOption[] = snap.docs.map((d) => {
        const raw = d.data() as any;
        return {
          id: d.id,
          title: String(raw.title ?? ''),
          description: raw.description ? String(raw.description) : undefined,
          price: Number(raw.price ?? 0),
          isActive: Boolean(raw.isActive ?? true),
          sortOrder: Number.isFinite(raw.sortOrder) ? Number(raw.sortOrder) : undefined,
          createdAt: raw.createdAt,
          updatedAt: raw.updatedAt,
        };
      });
      setList(arr);
      setLoading(false);
    });
    return () => unsub();
  }, [db]);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    try {
      await addDoc(collection(db, 'deliveryOptions'), {
        title: title.trim(),
        description: description.trim() || '',
        price: Number(price || 0),
        isActive: Boolean(isActive),
        sortOrder: Number(sortOrder || 0),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setTitle('');
      setDescription('');
      setPrice(0);
      setIsActive(true);
      setSortOrder(0);
      alert('Option created');
    } catch (e) {
      console.error(e);
      alert('The option could not be created');
    }
  }

  async function onUpdate(it: DeliveryOption) {
    try {
      await updateDoc(doc(db, 'deliveryOptions', it.id), {
        title: it.title.trim(),
        description: it.description?.trim() || '',
        price: Number(it.price || 0),
        isActive: Boolean(it.isActive),
        sortOrder: Number(it.sortOrder || 0),
        updatedAt: serverTimestamp(),
      });
      alert('Updated option');
    } catch (e) {
      console.error(e);
      alert('Could not update');
    }
  }

  async function onDelete(id: string) {
    if (!confirm('Remove this shipping option?')) return;
    try {
      await deleteDoc(doc(db, 'deliveryOptions', id));
      alert('Delted');
    } catch (e) {
      console.error(e);
      alert('Could not delete');
    }
  }

  return (
    <div className="container py-4">
      <h1 className="h4 mb-3">Delivery options</h1>

      {/* Crear nueva */}
      <div className="card border-0 shadow-sm mb-4">
        <div className="card-header">
          <div className="fw-semibold">Create delivery option</div>
        </div>
        <form className="card-body" onSubmit={onCreate}>
          <div className="row g-3">
            <div className="col-md-4">
              <label className="form-label">Title</label>
              <input className="form-control" value={title} onChange={(e) => setTitle(e.target.value)} required />
            </div>
            <div className="col-md-4">
              <label className="form-label">Description</label>
              <input className="form-control" value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
            <div className="col-md-2">
              <label className="form-label">Price</label>
              <input
                type="number"
                step="0.01"
                min="0"
                className="form-control"
                value={price}
                onChange={(e) => setPrice(Number(e.target.value))}
                required
              />
              {/* Si quieres mostrar el preview formateado:
                  <div className="form-text">{fmtQ(price)}</div>
               */}
            </div>
            <div className="col-md-1">
              <label className="form-label">Active</label>
              <div className="form-check mt-2">
                <input
                  type="checkbox"
                  className="form-check-input"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                />
              </div>
            </div>
            <div className="col-md-1">
              <label className="form-label">Order</label>
              <input
                type="number"
                className="form-control"
                value={sortOrder}
                onChange={(e) => setSortOrder(Number(e.target.value))}
              />
            </div>
          </div>
          <div className="mt-3">
            <button className="btn btn-primary" type="submit">
              Save
            </button>
          </div>
        </form>
      </div>

      {/* Listado y edición */}
      <div className="card border-0 shadow-sm">
        <div className="card-header">
          <div className="fw-semibold">List</div>
        </div>
        <div className="card-body">
          {loading ? (
            <div>Loading...</div>
          ) : list.length === 0 ? (
            <div className="text-muted">No records.</div>
          ) : (
            <div className="table-responsive">
              <table className="table align-middle">
                <thead>
                  <tr>
                    <th style={{ width: 220 }}>Title</th>
                    <th>Description</th>
                    <th style={{ width: 120 }}>Price</th>
                    <th style={{ width: 80 }}>Active</th>
                    <th style={{ width: 100 }}>Order</th>
                    <th style={{ width: 180 }} className="text-end">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((it, idx) => (
                    <tr key={it.id}>
                      <td>
                        <input
                          className="form-control"
                          value={it.title}
                          onChange={(e) => {
                            const v = e.target.value;
                            setList((arr) => arr.map((x, i) => (i === idx ? { ...x, title: v } : x)));
                          }}
                        />
                      </td>
                      <td>
                        <input
                          className="form-control"
                          value={it.description || ''}
                          onChange={(e) => {
                            const v = e.target.value;
                            setList((arr) => arr.map((x, i) => (i === idx ? { ...x, description: v } : x)));
                          }}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          className="form-control"
                          value={it.price}
                          onChange={(e) => {
                            const v = Number(e.target.value);
                            setList((arr) => arr.map((x, i) => (i === idx ? { ...x, price: Number.isFinite(v) ? v : 0 } : x)));
                          }}
                        />
                        {/* Preview formateado opcional:
                            <div className="form-text">{fmtQ(it.price)}</div>
                         */}
                      </td>
                      <td>
                        <input
                          type="checkbox"
                          className="form-check-input"
                          checked={!!it.isActive}
                          onChange={(e) => {
                            const v = e.target.checked;
                            setList((arr) => arr.map((x, i) => (i === idx ? { ...x, isActive: v } : x)));
                          }}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          className="form-control"
                          value={it.sortOrder ?? 0}
                          onChange={(e) => {
                            const v = Number(e.target.value);
                            setList((arr) => arr.map((x, i) => (i === idx ? { ...x, sortOrder: Number.isFinite(v) ? v : 0 } : x)));
                          }}
                        />
                      </td>
                      <td className="text-end">
                        <button className="btn btn-sm btn-outline-primary me-2" onClick={() => onUpdate(it)}>
                          Save
                        </button>
                        <button className="btn btn-sm btn-outline-danger" onClick={() => onDelete(it.id)}>
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
