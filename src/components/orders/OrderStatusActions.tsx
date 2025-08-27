// src/components/orders/OrderStatusActions.tsx
'use client';

import { useState, useMemo } from 'react';
import { getAuth } from 'firebase/auth';

// Si ya tienes un helper global, puedes reemplazar por tu import.
// Este helper local agrega el Bearer token automáticamente.
async function apiFetch(path: string, init?: RequestInit) {
  const auth = getAuth();
  const user = auth.currentUser;
  const headers: HeadersInit = { ...(init?.headers || {}), 'Content-Type': 'application/json' };
  if (user) {
    const token = await user.getIdToken();
    (headers as any)['Authorization'] = `Bearer ${token}`;
  }
  return fetch(path, { ...init, headers });
}

type Props = {
  orderId: string;
  currentStatus: string;         // estado actual (normalizado)
  role?: 'kitchen' | 'cashier' | 'courier' | 'admin';
  onTransition?: (from: string, to: string) => void; // callback opcional
  compact?: boolean;             // versión compacta de botones
};

const NEXT_BY_ROLE: Record<NonNullable<Props['role']>, string[]> = {
  kitchen: ['kitchen_in_progress', 'kitchen_done', 'ready_to_close'],
  cashier: ['ready_to_close', 'closed'],
  courier: ['assigned_to_courier', 'on_the_way', 'delivered'],
  admin:   ['placed','kitchen_in_progress','kitchen_done','ready_to_close','assigned_to_courier','on_the_way','delivered','closed','cancelled'],
};

// Etiquetas bonitas para UI
const LABELS: Record<string,string> = {
  placed: 'Aceptar',
  kitchen_in_progress: 'En cocina',
  kitchen_done: 'Cocina lista',
  ready_to_close: 'Listo para cobrar',
  assigned_to_courier: 'Asignar repartidor',
  on_the_way: 'En camino',
  delivered: 'Entregado',
  closed: 'Cerrado',
  cancelled: 'Cancelar',
};

export default function OrderStatusActions({
  orderId,
  currentStatus,
  role = 'admin',
  onTransition,
  compact = false,
}: Props) {
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Filtra acciones relevantes para el rol actual.
  const allowedTargets = useMemo(() => {
    const candidates = NEXT_BY_ROLE[role] || [];
    // Opcional: reglas simples para esconder redundantes según estado actual
    // (el backend igual valida con canTransition)
    return candidates;
  }, [role]);

  const doTransition = async (nextStatus: string) => {
    setError(null);
    setLoading(nextStatus);
    try {
      const resp = await apiFetch(`/api/orders/${orderId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ nextStatus }),
      });
      const data = await resp.json();

      if (!resp.ok) {
        // Respuesta de error del backend (puede traer invalid, from, to)
        setError(data?.message || 'No se pudo cambiar el estado.');
      } else {
        onTransition?.(currentStatus, nextStatus);
      }
    } catch (e: any) {
      setError(e?.message || 'Error de red.');
    } finally {
      setLoading(null);
    }
  };

  if (!orderId) return null;

  return (
    <div className={`flex flex-wrap gap-2 ${compact ? 'text-sm' : ''}`}>
      {allowedTargets.map((target) => (
        <button
          key={target}
          onClick={() => doTransition(target)}
          disabled={!!loading}
          className={`px-3 py-1 rounded-md border
            ${loading === target ? 'opacity-60 cursor-wait' : 'hover:bg-gray-100'}
          `}
          title={`Cambiar a: ${target}`}
        >
          {LABELS[target] || target}
        </button>
      ))}
      {error && (
        <span className="text-red-600 ml-2">{error}</span>
      )}
    </div>
  );
}
