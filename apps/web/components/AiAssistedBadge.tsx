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
        className="disclosure disclosure--ai"
        style={{
          display: "inline-block",
          fontSize: "0.75rem",
          padding: "0.25rem 0.5rem",
          marginTop: "0.5rem",
        }}
        role="note"
      >
        {text}
        {authorName ? <> · door {authorName}</> : null}
      </span>
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: server-rendered JSON-LD
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonld) }}
      />
    </>
  );
}
