/* src/app/(client)/app/settings/page.tsx */
'use client';
import { useState } from 'react';
import type { Address } from '@/types/client';

export default function SettingsPage() {
  const [addresses, setAddresses] = useState<Address[]>([]);
  return (
    <section className="space-y-3">
      <h1 className="text-xl font-semibold">Settings</h1>
      <p>Manage your phone and addresses.</p>
      <div className="border rounded p-3">
        <h2 className="font-semibold mb-2">Addresses</h2>
        {addresses.length === 0 && <p>No addresses yet.</p>}
      </div>
    </section>
  );
}
