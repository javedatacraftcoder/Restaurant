// app/layout.tsx
import type { Metadata } from 'next';
import Providers from './providers';
import 'bootstrap/dist/css/bootstrap.min.css';
import './globals.css';
import { NewCartProvider } from '@/lib/newcart/context';
import { SettingsProvider } from '@/lib/settings/context'; // ✅ Nuevo: provider global de settings

export const metadata: Metadata = {
  title: 'OrderCraft',
  description: 'App de restaurante',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" data-bs-theme="light">
      {/* 👇 cambio mínimo: suprime warnings si el cliente ajusta clases */}
      <body className="bg-white text-dark" suppressHydrationWarning>
        <SettingsProvider>
          <NewCartProvider>
            <Providers>{children}</Providers>
          </NewCartProvider>
        </SettingsProvider>
      </body>
    </html>
  );
}
