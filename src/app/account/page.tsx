"use client";
import "@/lib/firebase/client";
import { useEffect, useState } from "react";
import { getAuth, onAuthStateChanged, getIdTokenResult, signOut } from "firebase/auth";

export default function AccountPage() {
  const [user, setUser] = useState<any>(null);
  const [claims, setClaims] = useState<any>(null);

  useEffect(() => {
    const auth = getAuth();
    return onAuthStateChanged(auth, async (u) => {
      setUser(u || null);
      setClaims(null);
      if (u) {
        const res = await getIdTokenResult(u, true);
        setClaims(res.claims || null);
      }
    });
  }, []);

  if (!user) {
    return (
      <main className="p-6">
        <p>No has iniciado sesión. <a className="underline" href="/login">Ir a /login</a></p>
      </main>
    );
  }

  return (
    <main className="p-6 space-y-3">
      <div>UID: <code>{user.uid}</code></div>
      <div>
        Claims:
        <pre className="bg-gray-100 p-2 rounded text-xs">
{JSON.stringify(claims, null, 2)}
        </pre>
      </div>
      <div className="flex gap-3 text-sm">
        <a className="underline" href="/playground/order">Ir a /playground/order</a>
        <a className="underline" href="/ops">Ir a /ops</a>
        <button onClick={() => signOut(getAuth())} className="border px-2 py-1 rounded">
          Salir
        </button>
      </div>
    </main>
  );
}
