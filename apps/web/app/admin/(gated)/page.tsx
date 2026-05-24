// Admin dashboard placeholder.
// Phase 1.4 acceptance: shows that /admin requires login and renders.
// Real widgets land in Phase 2 (niche triage) and Phase 6 (cost telemetry).

import { getServiceRoleSupabase } from '../../../lib/supabase';

async function loadCounts() {
  const supabase = getServiceRoleSupabase();
  const [tenants, niches, candidates, runs] = await Promise.all([
    supabase.from('tenants').select('id', { count: 'exact', head: true }),
    supabase.from('niches').select('id', { count: 'exact', head: true }),
    supabase.from('niche_candidates').select('id', { count: 'exact', head: true }),
    supabase.from('agent_runs').select('id', { count: 'exact', head: true }),
  ]);
  return {
    tenants: tenants.count ?? 0,
    niches: niches.count ?? 0,
    candidates: candidates.count ?? 0,
    runs: runs.count ?? 0,
  };
}

export default async function AdminDashboard() {
  const counts = await loadCounts();

  const cardStyle: React.CSSProperties = {
    border: '1px solid #e5e5e5',
    borderRadius: '0.5rem',
    padding: '1rem',
    minWidth: 160,
  };

  return (
    <div>
      <h1 style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>Dashboard</h1>
      <p style={{ color: '#525252', marginBottom: '1.5rem' }}>
        Placeholder; echte widgets komen in Phase 2 (niche triage) en Phase 6
        (cost telemetry).
      </p>
      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
        <div style={cardStyle}>
          <div style={{ fontSize: '0.75rem', color: '#737373' }}>Tenants</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 600 }}>{counts.tenants}</div>
        </div>
        <div style={cardStyle}>
          <div style={{ fontSize: '0.75rem', color: '#737373' }}>Niches</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 600 }}>{counts.niches}</div>
        </div>
        <div style={cardStyle}>
          <div style={{ fontSize: '0.75rem', color: '#737373' }}>Candidates</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 600 }}>{counts.candidates}</div>
        </div>
        <div style={cardStyle}>
          <div style={{ fontSize: '0.75rem', color: '#737373' }}>Agent runs</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 600 }}>{counts.runs}</div>
        </div>
      </div>
    </div>
  );
}
