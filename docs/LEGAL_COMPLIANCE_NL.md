# Legal & Compliance — Netherlands + EU

What the engine must do to stay legal in NL/BE/EU. Written for an operator running as a Dutch eenmanszaak.

> **Disclaimer.** This is operational guidance, not legal advice. Confirm specifics with a Dutch accountant (boekhouder) and, where relevant, ICTRecht or a similar legal-tech firm. Where this doc says "likely" or "probably," treat as a starting point, not a final answer.

---

## 1. KvK & business structure

### Eenmanszaak (sole proprietorship)

The default starting structure. One KvK registration; you are personally liable; profits are taxed as personal income (Box 1) with the entrepreneur deductions (zelfstandigenaftrek, MKB-winstvrijstelling).

**SBI codes to register (max 3 active):**

| Code | Description | Why |
|---|---|---|
| **63.12** | Webportalen | Primary — affiliate websites are web portals |
| **73.11** | Reclamebureaus | Secondary — content-as-advertising |
| **58.19** | Overige uitgeverijen | Tertiary — publishing |

You can change SBI codes later for free; pick these as the starting set.

**When to switch to BV (Besloten Vennootschap):**
- Combined profit consistently >~€80k/year for 12+ months (tax efficiency kicks in)
- Significant liability exposure (less relevant for affiliate; more for SaaS)
- Co-founder or external investment
- **Not for v1.**

### Business address & home-address privacy

KvK and WHOIS are public. Your home address can leak via either route.

**Recommended:**
- Use a **virtual office / postbus** as registered business address (Regus, Spaces, or KvK-approved adresservice — ~€30–80/mo)
- Or use a KvK-accredited mail-handling service that lists the service address publicly
- For .nl domains, SIDN allows the registrar to mask natural-person registrant addresses; combined with a business address on KvK, WHOIS is reasonably private
- For .com/.eu via Cloudflare Registrar: free WHOIS redaction by default

---

## 2. Banking & accounting

### Banking

- **Bunq Business** (€9.99/mo Easy) — Dutch, KvK-integrated, great API
- **Wise Business** (~€0–10/mo) — multi-currency, good for non-EUR affiliate networks
- **N26 Business** (€0–9.90/mo) — basic but works

You need a separate business account from day one. Mixing private and business income breaks the deduction logic and irritates the Belastingdienst.

### Accounting

- **Moneybird** + freelance boekhouder review — ~€200–400/quarter total. Recommended.
- **Tellow** — full-service accounting subscription, ~€50–100/mo. Heavier.
- **Self-administer with e-Boekhouden** — viable if you're disciplined; cheap.

Pick one before first revenue. Migrating mid-year is painful.

---

## 3. BTW (VAT)

### General

- Eenmanszaak is BTW-plichtig from €1 turnover.
- Standard NL rate: 21%. Reduced: 9% (books, some categories). Affiliate income from EU networks is usually 21% with **BTW-verlegd** (reverse charge) on B2B invoices between EU businesses.

### Affiliate income BTW treatment

This is the part that confuses everyone:

| Network | Where based | BTW treatment |
|---|---|---|
| Bol.com Partner | NL | Bol invoices you with NL BTW (or with BTW-verlegd if structured as B2B reverse charge); the boekhouder books it correctly |
| Awin | UK/global, but EU operations | EU intra-community service: BTW-verlegd; you self-account |
| Daisycon | NL | Similar to Bol; verify with their invoice |
| Digistore24 | DE | Intra-EU BTW-verlegd; you self-account 21% |
| Impact.com | US | Outside EU; no VAT on commission income from US service provider — no input VAT to deduct, no output VAT to charge |

Operator action: at each quarterly BTW filing, ask the boekhouder to map each network correctly. Don't guess.

### Kleine ondernemersregeling (KOR)

- If projected annual turnover <€20k, you can opt into KOR and not charge or file BTW for 3 years.
- **Don't do this** for an affiliate publishing business that expects to grow. KOR blocks input VAT deduction on all your costs (Vercel, Supabase, Anthropic API, hosting, etc.) — and those input VAT amounts add up fast.
- Standard rule for v1: stay outside KOR, deduct input VAT on everything.

### OSS (One Stop Shop)

Only relevant if you sell digital services/goods cross-border to EU consumers. **Pure affiliate referral income does not trigger OSS.** If you ever add a digital product or course, the picture changes.

---

## 4. DAC7 — likely out of scope, confirm with adviser

DAC7 (EU Council Directive 2021/514) requires *platform operators* to report seller income to tax authorities.

**Affected activities (in scope of DAC7):**
1. Sale of goods
2. Personal services
3. Rental of immovable property
4. Rental of any mode of transport

**Affiliate publishing is not directly any of these.** You don't connect sellers to buyers; you refer traffic via affiliate links to *their* platforms. The receiving platforms (Bol, Awin, etc.) might be in DAC7 scope themselves, but as a publisher receiving commissions, you are not the "platform operator" under the directive.

**However:**
- If you ever add a digital product, course, marketplace, or paid newsletter on your own domains, you may become a platform operator.
- If you become a Bol.com seller (not just affiliate), Bol reports you under DAC7.
- Plan for this in case Phase 7+ adds first-party products.

**Operator action:** ask the boekhouder to confirm DAC7 non-applicability at the first quarterly review. Get it in writing.

---

## 5. EU AI Act — Article 50 transparency

### Timeline

- **Final Code of Practice:** June 2026
- **Article 50 obligations apply:** **August 2026**
- Penalties up to €15M or 3% global turnover (irrelevant for a solo operator in monetary terms, but the disclosure itself is cheap to add)

### What you must do as a deployer of generative AI

Article 50 distinguishes "provider" (Anthropic, OpenAI) and "deployer" (you).

**Your obligations as deployer:**

1. **Text disclosure** — AI-generated text "published with the purpose of informing the public on matters of public interest" must be disclosed as artificially generated.
2. **Visible label at first exposure** — the draft Code of Practice proposes a common AI label icon shown to readers near the byline.

"Matters of public interest" is broad. Affiliate review content about consumer products plausibly qualifies in many cases. **Safest position:** disclose by default, every time.

### Implementation in the engine

Every page generated with AI assistance:

1. **Visible badge** near the byline:
   ```
   ✦ AI-assisted — Dit artikel is geschreven met hulp van AI en geredigeerd door [author name].
   ```

2. **JSON-LD declaration** in `<head>`:
   ```json
   {
     "@context": "https://schema.org",
     "@type": "Article",
     "aiContentDeclaration": {
       "aiAssistanceLevel": "drafted-with-human-editing",
       "model": "claude-sonnet-4-6",
       "humanEditor": "...",
       "lastEditedAt": "..."
     }
   }
   ```
   (The exact schema is not yet finalised by the EU; this is a reasonable interpretation. Update when Code of Practice lands June 2026.)

3. **Sitewide `/ai-disclosure` page** linked from the footer. Template content provided in `apps/web/app/(public)/ai-disclosure/template.md`.

4. **Database flag** — `pages.ai_assisted` defaults to `true` for any page that went through the Content Agent.

**Operator action:** when the final Code of Practice publishes (June 2026), revisit the label format and update if required.

### Visual content

Original photographs from operator first-party tests are *not* AI-generated and don't require disclosure under Article 50.
AI-generated or AI-modified imagery (if used) requires its own watermark/label. Default policy: avoid AI imagery on commercial pages. Use only operator photos or licensed stock with the license terms tracked.

---

## 6. GDPR (AVG)

### Lawful basis & consent

- **Affiliate cookies** — require consent (not strictly necessary).
- **Anonymous analytics** — Plausible is cookieless; legitimate interest basis acceptable.
- **Funnel analytics** — PostHog with consent.

### Klaro! CMP configuration

Self-hosted Klaro! per tenant. Categories:

| Category | Required | Examples |
|---|---|---|
| Strictly necessary | yes (no consent needed) | session cookie, CSRF, language pref |
| Analytics | no (consent required, defaults off) | PostHog session |
| Affiliate tracking | no (consent required, defaults off) | Bol, Awin, Daisycon, Impact cookies |
| Marketing | not used at MVP | — |

Klaro! config lives in `tenants.config.consent.klaroConfig`; one Klaro! snippet renders per tenant from the same Next.js component.

### DPAs (Data Processing Agreements)

You need a DPA with every processor:

- **Anthropic** — DPA available at https://www.anthropic.com/legal/dpa
- **Supabase** — DPA available in their compliance portal
- **Vercel** — DPA available in their compliance portal
- **Cloudflare** — DPA available
- **Resend** — DPA available
- **PostHog** — DPA available; ensure EU cloud
- **Sentry** — DPA available

Store signed DPAs in a `compliance/` folder (not git; in your password manager / 1Password).

### Privacy verklaring

Per tenant, render `/privacy` from a template populated with: processors used, retention periods, contact email, KvK number, AP (Autoriteit Persoonsgegevens) reference.

Template lives in `apps/web/app/(public)/[locale]/privacy/template.md`. Per-tenant overrides in `tenants.config.legal.privacyOverrides`.

### Retention

| Data | Retention | Reason |
|---|---|---|
| `clicks` | 24 months then anonymised | Sufficient for promotion-gate calculations |
| `conversions` | 7 years | Belastingdienst record-keeping |
| `agent_runs` outputs | 12 months then summarised | Cost analysis, audit |
| Operator emails on login | indefinite (allowed_admins) | Auth |
| GSC pulled metrics | 3 years | Trend analysis |

Implemented as a daily cron in `apps/scrapers/src/jobs/retention.ts`.

### Right of access / erasure

The engine collects almost no personal data — `clicks.ip_hash` is hashed at collection, never raw IP. The operator's own admin login is the only identifiable user data. If a third party requests data, treat the request seriously and respond within 30 days.

---

## 7. Reclame Code (advertising disclosure)

### NL — Nederlandse Reclame Code Art. 11

Affiliate content is advertising-like and must be clearly identifiable as such.

**Required:** above-the-fold disclosure on every monetised page, in the visitor's language.

- NL: *Deze pagina bevat affiliate links. Als je via een link iets koopt, ontvangen wij een commissie, zonder extra kosten voor jou.*
- EN (where used): *This page contains affiliate links. If you buy through a link, we earn a commission at no extra cost to you.*

Place in the page body, server-rendered, never inside a collapsed accordion or cookie banner.

### BE — Reclamecode Commissie

Similar requirements. Belgian consumers expect Dutch disclosures for NL content, French for FR content.

### Reclamecode Social Media en Influencer Marketing

Applies to influencer-style content with personalities/brand mentions. The engine's content is publisher-style (third-person review or guide), so this code is largely not the primary risk vector — but if the operator ever adds first-person video or social content, this code applies.

---

## 8. ACM (Autoriteit Consument & Markt)

Consumer law: prices shown to consumers must include VAT. The engine doesn't sell directly, so this applies only to displayed prices in product comparisons.

**Convention:** all displayed prices include VAT (NL standard). Mark explicitly in `tenants.config.legal.priceDisplay = 'gross_including_vat'`.

---

## 9. DSA (Digital Services Act)

DSA applies to "intermediary services" — including hosting, online marketplaces, and search engines.

A multi-niche affiliate publisher *technically* qualifies as a "mere conduit" / "hosting service" by the broadest reading, but DSA's substantive obligations target platforms ≥45M monthly EU users (VLOPs/VLOSEs). You're not in scope at MVP.

**Basic transparency duties** (apply at any scale):
- Clear identification of who runs the site (impressum/colofon)
- Easy way to contact the operator (email link minimum)
- Terms of service

**Operator action:** add a per-tenant `/colofon` page with: legal name, KvK number, BTW number (only if needed), contact email, AVG-officer contact (your own email at MVP).

---

## 10. Trademark screening

Before any domain registration or brand-candidate adoption:

1. **EUIPO TMview** — search the candidate name. Flag any registered match in Nice classes 9 (software), 35 (advertising/business), 41 (entertainment/publishing), 42 (technology services).
2. **BOIP (Benelux)** — for Benelux-specific matches.
3. **Google.nl / common-sense** — also search the name; obvious clashes with well-known brands (even if no formal registration) get rejected.

The Scoring Agent runs the EUIPO check; the Promotion Agent re-runs it before registration.

A trademark conflict is a **hard block** in `docs/NICHE_SCORING_RUBRIC.md`.

---

## 11. SIDN (.nl registry) specifics

- Personal-name eenmanszaak must use the KvK trade name as registrant, not the personal name (depending on registrar config).
- SIDN allows WHOIS masking for natural-person registrants — confirm your registrar applies this.
- DNSSEC is encouraged. Cloudflare DNS makes this one-click.
- Disputes: SIDN's WIPO-style arbitration process exists; you (as registrant) can be challenged by trademark holders. The screening in §10 prevents most cases.

---

## 12. ANBI, charity, edge cases — not relevant

These don't apply to the engine. Mentioned only so they're crossed off the list.

---

## 13. Operator's quarterly compliance checklist

Run through this every quarter. The Orchestrator agent surfaces it as a reminder in the weekly report at the start of each new quarter.

- [ ] BTW return filed by boekhouder
- [ ] Income/expense ledger reconciled in Moneybird
- [ ] Bank account reconciled; affiliate payouts categorised correctly
- [ ] DPAs still valid for all processors
- [ ] AI Act disclosure language matches latest Code of Practice (after June 2026)
- [ ] Privacy verklaring per tenant up to date with current processors
- [ ] No new SBI codes needed
- [ ] Cookiebot / Klaro! config reviewed; new tracking cookies catalogued
- [ ] Retention cron is running and pruning correctly
- [ ] No SIDN/BOIP arbitration notices
- [ ] No Belastingdienst correspondence pending
- [ ] No ACM/AFM correspondence pending

---

## 14. When something goes wrong

- **Belastingdienst inquiry:** route to boekhouder same day. Don't reply directly.
- **Trademark cease & desist:** stop using the disputed name; consult ICTRecht; consider rebranding the affected niche.
- **GDPR data request:** acknowledge within 7 days, respond within 30. Log in a `compliance_log` table.
- **Algorithm penalty (manual action in GSC):** focus on fixing the underlying issue (E-E-A-T gaps, thin content); file reconsideration request only after substantial improvements.
- **Affiliate-network audit / commission clawback:** keep good records of clicks, conversions, and source URLs in `clicks` and `conversions`. The engine's logging is your defense.

---

## Reading list

- KvK eenmanszaak: https://www.kvk.nl/starten/wat-is-een-eenmanszaak/
- Belastingdienst BTW: https://www.belastingdienst.nl/wps/wcm/connect/nl/btw
- AP (Autoriteit Persoonsgegevens): https://autoriteitpersoonsgegevens.nl/
- EU AI Act Article 50: https://artificialintelligenceact.eu/article/50/
- DAC7 NL guidance: https://www.belastingdienst.nl/wps/wcm/connect/bldcontentnl/belastingdienst/zakelijk/internationaal/dac7
- SIDN .nl registration: https://www.sidn.nl/
- Nederlandse Reclame Code: https://www.reclamecode.nl/
- EUIPO TMview: https://www.tmdn.org/tmview/
