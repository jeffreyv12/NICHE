// Fallback root page — reached only if middleware did not match a tenant.
// Treat this as a 404-ish landing rather than a public marketing page.

export default function RootFallback() {
  return (
    <main style={{ maxWidth: 640, margin: '4rem auto', padding: '0 1rem' }}>
      <h1>NicheFinder</h1>
      <p>
        Dit subdomein/host is niet aan een tenant gekoppeld. Als je dit verwacht
        wel te zien — controleer dat <code>PRIMARY_TENANT_HOSTNAME</code> in je
        env klopt en dat de tenants-tabel een rij heeft voor deze hostname.
      </p>
      <p>
        <a href="/admin">Naar admin</a>
      </p>
    </main>
  );
}
