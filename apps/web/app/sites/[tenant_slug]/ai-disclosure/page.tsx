// Sitewide AI-disclosure page. Linked from every tenant footer.
// Required by EU AI Act Article 50 (effective August 2026). See CLAUDE.md
// non-negotiable #4.

import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'AI-disclosure',
  description:
    'Hoe AI-assistentie wordt ingezet bij de productie van content op deze site.',
};

export default function AiDisclosurePage() {
  return (
    <article style={{ lineHeight: 1.65 }}>
      <h1>AI-disclosure</h1>

      <p>
        Veel artikelen op deze site worden voorbereid met behulp van AI
        (Anthropic Claude). Elke pagina is door een menselijke redacteur
        beoordeeld, gecorrigeerd en goedgekeurd voor publicatie.
      </p>

      <h2>Wat doet AI hier wel</h2>
      <ul>
        <li>Eerste concepten op basis van producten en specificaties uit officiële databronnen.</li>
        <li>Structuur (kopjes, lijsten, FAQ-blokken) op basis van zoekintentie.</li>
        <li>Vertaalde citaten uit Engelstalige bronnen, gemarkeerd als citaat.</li>
      </ul>

      <h2>Wat doet AI hier niet</h2>
      <ul>
        <li>Medisch, financieel of juridisch advies — wij weigeren dat type content.</li>
        <li>Reviews van producten die de auteur niet werkelijk heeft getest.</li>
        <li>Prijzen of specificaties verzinnen — elke claim is gekoppeld aan een bron.</li>
      </ul>

      <h2>Markeringen op elke pagina</h2>
      <ul>
        <li>
          Een zichtbare <em>AI-assisted</em>-badge bij de byline van elk artikel.
        </li>
        <li>
          Een <code>aiContentDeclaration</code>-JSON-LD blok in de <code>&lt;head&gt;</code>.
        </li>
        <li>Een link naar deze pagina vanuit elke footer.</li>
      </ul>

      <h2>Vragen?</h2>
      <p>Stuur een mail naar het adres in het colofon.</p>
    </article>
  );
}
