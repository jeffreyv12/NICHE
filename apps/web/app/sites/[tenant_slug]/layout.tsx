// Per-tenant layout. Reads the tenant config (brand colours, locale) and
// injects CSS variables + lang attr.

import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { getServiceRoleSupabase } from '../../../lib/supabase';
import { AffiliateDisclosure } from '../../../components/AffiliateDisclosure';

interface TenantConfig {
  brand?: {
    name?: string;
    primaryColor?: string;
    accentColor?: string;
    backgroundColor?: string;
    textColor?: string;
  };
  locale?: {
    primary?: string;
  };
  affiliate?: {
    disclosureText?: { nl?: string; en?: string };
  };
}

interface TenantRow {
  id: string;
  slug: string;
  config: TenantConfig;
}

async function loadTenant(slug: string): Promise<TenantRow | null> {
  const supabase = getServiceRoleSupabase();
  const { data, error } = await supabase
    .from('tenants')
    .select('id, slug, config')
    .eq('slug', slug)
    .eq('is_active', true)
    .maybeSingle();

  if (error || !data) return null;
  return data as TenantRow;
}

export default async function TenantLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ tenant_slug: string }>;
}) {
  const { tenant_slug } = await params;
  const tenant = await loadTenant(tenant_slug);
  if (!tenant) notFound();

  const brand = tenant.config?.brand ?? {};
  const lang = tenant.config?.locale?.primary ?? 'nl-NL';

  const cssVars: Record<string, string> = {};
  if (brand.primaryColor) cssVars['--brand-primary'] = brand.primaryColor;
  if (brand.accentColor) cssVars['--brand-accent'] = brand.accentColor;
  if (brand.backgroundColor) cssVars['--brand-bg'] = brand.backgroundColor;
  if (brand.textColor) cssVars['--brand-text'] = brand.textColor;

  return (
    <div lang={lang} style={cssVars}>
      <AffiliateDisclosure
        textNl={tenant.config?.affiliate?.disclosureText?.nl}
        textEn={tenant.config?.affiliate?.disclosureText?.en}
      />
      <main style={{ maxWidth: 960, margin: '0 auto', padding: '1.5rem 1rem' }}>
        {children}
      </main>
      <footer
        style={{
          maxWidth: 960,
          margin: '3rem auto 1rem',
          padding: '1rem',
          fontSize: '0.875rem',
          color: 'var(--brand-secondary)',
        }}
      >
        <p>
          <a href="/ai-disclosure">AI-disclosure</a> ·{' '}
          <a href="/privacy">Privacy</a> · <a href="/colofon">Colofon</a>
        </p>
      </footer>
    </div>
  );
}
