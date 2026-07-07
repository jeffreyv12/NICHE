// AI-assisted badge near every byline + JSON-LD aiContentDeclaration.
// Required by EU AI Act Article 50 (effective 2026-08). CLAUDE.md non-negotiable #4.

import { AI_BADGE_DEFAULT_TEXT, buildAiContentDeclaration } from "@nichefinder/shared";

interface Props {
  /** Optional human author name to render alongside the badge. */
  authorName?: string;
  /** Optional inline override of the message text. */
  badgeText?: string;
}

export function AiAssistedBadge({ authorName, badgeText }: Props) {
  const text = badgeText ?? AI_BADGE_DEFAULT_TEXT;
  const jsonld = buildAiContentDeclaration({ authorName });

  return (
    <>
      <span
        role="note"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "0.3rem",
          fontSize: "0.75rem",
          fontWeight: 500,
          padding: "0.2rem 0.6rem",
          borderRadius: "9999px",
          background: "#eff6ff",
          border: "1px solid #93c5fd",
          color: "#1e40af",
          letterSpacing: "0.01em",
        }}
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
        </svg>
        {text}
        {authorName ? <> · {authorName}</> : null}
      </span>
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: server-rendered JSON-LD
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonld) }}
      />
    </>
  );
}
