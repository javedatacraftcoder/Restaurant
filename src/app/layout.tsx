// app/layout.tsx
import type { Metadata } from 'next';
import Providers from './providers';
import 'bootstrap/dist/css/bootstrap.min.css';
import './globals.css';
import { NewCartProvider } from '@/lib/newcart/context';

export const metadata: Metadata = {
  title: 'OrderCraft',
  description: 'App de restaurante',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" data-bs-theme="light">
      <body className="bg-white text-dark">
        <NewCartProvider>
          <Providers>{children}</Providers>
        </NewCartProvider>
      </body>
    </html>
  );
}
