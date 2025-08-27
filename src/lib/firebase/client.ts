// src/lib/firebase/client.ts
import { initializeApp, getApps, getApp } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  setPersistence,
  indexedDBLocalPersistence,
  browserLocalPersistence,
  connectAuthEmulator,
} from "firebase/auth";

// Config desde .env.local (todas las NEXT_PUBLIC_* deben existir en el cliente)
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY!,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN!,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID!,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID!,
  // Opcionales:
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
};

// Inicializa la app 1 sola vez (válido en SSR/CSR)
export const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

// En SSR no debemos tocar Auth (usa window). Creamos instancias solo en cliente.
let _auth: ReturnType<typeof getAuth> | null = null;
let _googleProvider: GoogleAuthProvider | null = null;

if (typeof window !== "undefined") {
  _auth = getAuth(app);

  // Persistencia: intenta IndexedDB; si falla (Safari privado) cae a localStorage.
  setPersistence(_auth, indexedDBLocalPersistence).catch(() =>
    setPersistence(_auth!, browserLocalPersistence).catch(() => {
      /* ignore */
    })
  );

  // Idioma del dispositivo para flujos (p. ej. SMS/Email templates de Firebase)
  // @ts-ignore - useDeviceLanguage existe en runtime aunque no tipado en algunos setups
  _auth.useDeviceLanguage?.();

  _googleProvider = new GoogleAuthProvider();

  // Emulador de Auth (opcional): setea en .env.local
  // NEXT_PUBLIC_FIREBASE_EMULATORS=1
  // NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_URL=http://127.0.0.1:9099
  if (process.env.NEXT_PUBLIC_FIREBASE_EMULATORS === "1") {
    try {
      connectAuthEmulator(
        _auth,
        process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_URL || "http://127.0.0.1:9099",
        { disableWarnings: true }
      );
    } catch {
      // no-op
    }
  }

  // ⚡️ Solo en dev: expón auth en window para debugging
  if (process.env.NODE_ENV !== "production") {
    (window as any).__auth = _auth;
  }
}

// Exports para uso en componentes cliente
export const auth = _auth as ReturnType<typeof getAuth>;
export const googleProvider = _googleProvider as GoogleAuthProvider;
