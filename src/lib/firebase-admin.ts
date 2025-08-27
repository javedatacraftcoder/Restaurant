// src/lib/firebase-admin.ts
import { getApps, initializeApp, cert, App } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage as getAdminStorage } from 'firebase-admin/storage';

let adminApp: App;

if (!getApps().length) {
  adminApp = initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      // Reemplaza \n literales por saltos reales
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  });
} else {
  adminApp = getApps()[0]!;
}

export const db = getFirestore(adminApp);
export const storageAdmin = getAdminStorage().bucket();
