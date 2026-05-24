// Tenant homepage placeholder. Real content lives in Phase 4 (Content Engine).

import { getServiceRoleSupabase } from '../../../lib/supabase';
import { AiAssistedBadge } from '../../../components/AiAssistedBadge';

interface PageProps {
  params: Promise<{ tenant_slug: string }>;
}

export default async function TenantHome({ params }: PageProps) {
  const { tenant_slug } = await params;
  const supabase = getServiceRoleSupabase();
  const { data } = await supabase
    .from('tenants')
    .select('config')
    .eq('slug', tenant_slug)
    .maybeSingle();

  const brandName =
    (data?.config as { brand?: { name?: string } } | undefined)?.brand?.name ?? tenant_slug;

  return (
    <article>
      <header>
        <h1 style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>
          Welkom bij {brandName}
        </h1>
        <AiAssistedBadge />
      </header>
      <p style={{ marginTop: '1rem', lineHeight: 1.6 }}>
        Dit is een placeholder homepage. De Content Agent levert hier in Phase 4
        de echte landing — een topic-hub met links naar de gepubliceerde pagina's,
        gefilterd op intent en seizoen.
      </p>
      <p style={{ marginTop: '1rem' }}>
        <strong>Tenant slug:</strong> <code>{tenant_slug}</code>
      </p>
    </article>
  );
}
