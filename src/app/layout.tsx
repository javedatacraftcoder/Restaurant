// src/app/layout.tsx
import type { Metadata } from 'next';
import Providers from './providers';
import 'bootstrap/dist/css/bootstrap.min.css';
import './globals.css';

export const metadata: Metadata = {
  title: 'Restaurante',
  description: 'App de restaurante',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" data-bs-theme="light">
      <body className="bg-white text-dark">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
