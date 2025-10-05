// src/app/AuthProvider.tsx
'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { onIdTokenChanged, getAuth } from 'firebase/auth';
import { app } from '@/lib/firebase/client'; // ya lo tienes de Etapa 1

type AuthContextValue = {
  user: any | null;
  idToken: string | null;
  loading: boolean;
};

const AuthCtx = createContext<AuthContextValue>({
  user: null,
  idToken: null,
  loading: true,
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<any | null>(null);
  const [idToken, setIdToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const auth = getAuth(app);
    // Se ejecuta cada vez que el token de Firebase cambia
    return onIdTokenChanged(auth, async (usr) => {
      if (usr) {
        setUser(usr);
        const token = await usr.getIdToken();
        setIdToken(token);
      } else {
        setUser(null);
        setIdToken(null);
      }
      setLoading(false);
    });
  }, []);

  return (
    <AuthCtx.Provider value={{ user, idToken, loading }}>
      {children}
    </AuthCtx.Provider>
  );
}

export function useAuth() {
  return useContext(AuthCtx);
}
