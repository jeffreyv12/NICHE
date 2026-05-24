// Admin magic-link login. Public route — does NOT use the admin layout
// (which would redirect-loop). Lives at /admin/login with its own minimal layout.

import { sendMagicLink } from './actions';

export const metadata = { title: 'Admin login' };

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; sent?: string }>;
}) {
  const params = await searchParams;
  const error = params.error;
  const sent = params.sent === '1';

  return (
    <main style={{ maxWidth: 420, margin: '4rem auto', padding: '0 1rem' }}>
      <h1 style={{ fontSize: '1.5rem' }}>Admin login</h1>
      <p style={{ color: '#525252', marginBottom: '1rem' }}>
        Voer je toegestane operator-email in. Je krijgt een magic link.
      </p>

      {sent && (
        <div className="disclosure" style={{ marginBottom: '1rem' }}>
          Magic link verzonden — check je mail.
        </div>
      )}

      {error === 'not_allowed' && (
        <div
          className="disclosure"
          style={{ background: '#fee2e2', borderColor: '#fca5a5', color: '#7f1d1d', marginBottom: '1rem' }}
        >
          Dit email-adres staat niet op de allowlist (<code>ADMIN_ALLOWED_EMAILS</code>).
        </div>
      )}
      {error === 'send_failed' && (
        <div
          className="disclosure"
          style={{ background: '#fee2e2', borderColor: '#fca5a5', color: '#7f1d1d', marginBottom: '1rem' }}
        >
          Verzenden mislukt. Probeer het opnieuw.
        </div>
      )}

      <form action={sendMagicLink} style={{ display: 'grid', gap: '0.75rem' }}>
        <label htmlFor="email">Email</label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          style={{
            padding: '0.5rem 0.75rem',
            border: '1px solid #d4d4d4',
            borderRadius: '0.375rem',
            fontSize: '1rem',
          }}
        />
        <button
          type="submit"
          style={{
            padding: '0.5rem 0.75rem',
            background: 'var(--brand-accent)',
            color: 'white',
            border: 0,
            borderRadius: '0.375rem',
            fontSize: '1rem',
            cursor: 'pointer',
          }}
        >
          Stuur magic link
        </button>
      </form>
    </main>
  );
}
