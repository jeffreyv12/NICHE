// Affiliate-disclosure banner. Rendered server-side, above the fold, on every
// tenant page. Required by CLAUDE.md non-negotiable #5.
//
// Per-tenant override: `tenants.config.affiliate.disclosureText.{nl,en}`.

const DEFAULT_NL =
  "Deze pagina bevat affiliate links. Als je via een link iets koopt ontvangen wij een commissie, zonder extra kosten voor jou.";
const DEFAULT_EN =
  "This page contains affiliate links. If you buy something through them we earn a small commission at no extra cost to you.";

export function AffiliateDisclosure({
  textNl,
  textEn,
}: {
  textNl?: string;
  textEn?: string;
}) {
  return (
    <div
      className="disclosure"
      style={{
        maxWidth: 960,
        margin: "1rem auto 0",
      }}
      role="note"
      aria-label="affiliate disclosure"
    >
      <p style={{ margin: 0 }} lang="nl">
        {textNl ?? DEFAULT_NL}
      </p>
      <p style={{ margin: "0.25rem 0 0" }} lang="en">
        <small>{textEn ?? DEFAULT_EN}</small>
      </p>
    </div>
  );
}
