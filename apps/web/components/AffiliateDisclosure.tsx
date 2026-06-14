// Affiliate-disclosure banner. Rendered server-side, above the fold, on every
// tenant page. Required by CLAUDE.md non-negotiable #5.
//
// Per-tenant override: `tenants.config.affiliate.disclosureText.{nl,en}`.

import { resolveAffiliateDisclosure } from "@nichefinder/shared";

export function AffiliateDisclosure({
  textNl,
  textEn,
}: {
  textNl?: string;
  textEn?: string;
}) {
  const { nl, en } = resolveAffiliateDisclosure({ nl: textNl, en: textEn });
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
        {nl}
      </p>
      <p style={{ margin: "0.25rem 0 0" }} lang="en">
        <small>{en}</small>
      </p>
    </div>
  );
}
