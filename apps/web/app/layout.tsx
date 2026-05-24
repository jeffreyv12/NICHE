import './globals.css';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';

// Root layout. Per-tenant brand + locale overrides live in
// app/sites/[tenant_slug]/layout.tsx (set CSS variables, switch lang attr).

export const metadata: Metadata = {
  title: { default: 'NicheFinder', template: '%s | NicheFinder' },
  description: 'Autonomous Dutch/Belgian niche discovery and validation engine.',
  robots: { index: false, follow: false }, // tenants override; root domain stays hidden
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="nl">
      <body>{children}</body>
    </html>
  );
}
