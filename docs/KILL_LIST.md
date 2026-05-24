# Kill List

Niche categories the discovery agent must reject. This list is the **first filter** of every Discovery and Scoring run, applied before any other reasoning.

> **For Claude Code:** if you ever find yourself reasoning "but this particular case is different," stop. The kill list overrides. Either the category is on the list (reject) or it isn't (continue). No middle ground.

The list has two parts:
- **§A — Hard blocks** — automatic rejection, no override possible
- **§B — Avoid list** — penalty applied in scoring; not automatic rejection but heavily down-weighted

---

## A. Hard blocks

Any candidate whose `topic`, `topic_slug`, `related_keywords`, or evidence content matches a stem here is rejected outright. No score is computed.

### A.1 YMYL — Regulated medical/health

**Why:** Geneesmiddelenwet (NL Medicines Act) plus EU regulation EU 1924/2006 (nutrition and health claims). Penalties severe; reputational risk enormous.

**Stems:** `geneesmiddel`, `medicijn`, `medicat`, `pharma`, `recept`, `apotheek`, `vitamine`, `supplement`, `voedingssupplement`, `kruid`, `homeopath`, `cbd`, `cannabidiol`, `hennep`, `marihuana`, `wiet`, `thc`, `psychedel`, `magic mushroom`, `truffles`, `paddo`, `kratom`, `nootropic`, `smart drug`, `aankoop medicijn`, `online apotheek`

**Symptoms / conditions:** `diabet`, `kanker`, `tumor`, `cardio`, `hartziekt`, `dementie`, `alzheimer`, `depressi`, `angststoornis`, `bipolair`, `adhd`, `autism`, `psoriasis`, `eczeem`, `acne` (only the *treatment* angle; product/skincare reviews are OK if framed as cosmetic)

**Adjacent but allowed (down-weighted YMYL, not blocked):**
- Cosmetic skincare reviews (product-focused, not medical claims)
- Ergonomic workspace gear (the chair, not the back pain treatment)
- Sleep accessories (mattresses, pillows; not sleep medication)
- Sports/fitness equipment (the gear, not the "lose 20kg in 4 weeks" angle)

### A.2 Financial advice / regulated

**Why:** Wet op het financieel toezicht (Wft); AFM (Autoriteit Financiële Markten) license required.

**Stems:** `beleg`, `belegging`, `crypto`, `bitcoin`, `ethereum`, `trading`, `daytrading`, `forex`, `cfd`, `optie`, `derivat`, `hypothee`, `lening`, `krediet`, `consumptief krediet`, `persoonlijke lening`, `verzeker`, `pensioen`, `belasting`, `box 3`, `vermogensbeheer`, `financieel advies`, `aandeel kopen`, `koers`

**Adjacent but allowed (Avoid list, not block):**
- General money-tips lifestyle ("zuinig leven," "boodschappen besparen")
- Reviews of personal-finance apps (the tool, not the advice)
- Bookkeeping tools (the software, not the tax advice)

### A.3 Gambling / kansspelen

**Why:** Kansspelautoriteit license required; affiliate marketing to unlicensed sites is illegal in NL.

**Stems:** `gok`, `gokken`, `casino`, `online casino`, `kansspel`, `wedden`, `bookmaker`, `sportweddenschap`, `bet`, `poker`, `roulette`, `blackjack`, `slot`, `gokautomaat`, `lotto`, `bingo`, `tombola`, `loterij` (Staatsloterij content allowed if purely informational, but no affiliate)

### A.4 Adult / 18+

**Why:** Bol Partner ToS, most affiliate networks' ToS, brand-safety, payment-processor sensitivity, and the engine's content style.

**Stems:** any explicit-content related term, dating affiliate networks, adult webcam, adult toys (the explicit subcategory — generic "wellness" is borderline allowed but down-weighted)

### A.5 Tobacco, vape, alcohol-marketing-to-minors

**Why:** Tabaks- en Rookwarenwet, Alcoholwet, age-restricted product advertising rules.

**Stems:** `sigaret`, `tabak`, `e-sigaret`, `vape`, `vaping`, `e-vloeistof`, `e-juice`, `nicotine pouch`, `snus`, `shisha`, `waterpijp`

**Adjacent but allowed (Avoid list):**
- Whisky/wine/beer tasting/reviewing (operator must add age verification + responsible-drinking language)
- Bartending gear

### A.6 Weapons

**Why:** Wet wapens en munitie; Bol Partner ToS prohibition.

**Stems:** `vuurwapen`, `pistool`, `geweer`, `airsoft` (gear borderline, weapons no), `kruisboog`, `messen` (only collectibles/cooking knives are fine; combat knives no), `pepper spray`, `taser`

### A.7 Counterfeits, replicas, deceptive

**Why:** illegal; brand-safety; Belastingdienst issues; affiliate network ToS.

**Stems:** `replica`, `1:1 watch`, `fake bag`, `aaa quality`, `dhgate`, `aliexpress dupe`, `superfake`, `mirror image`

### A.8 Pseudoscience / dangerous

**Why:** consumer-protection law; AI Act may treat "high-impact" misinformation as flagged.

**Stems:** `homeop`, `bach bloesem`, `aura`, `chakra` (where claiming healing), `flat earth`, `vaccin` (with any negative claim; pure scheduling info OK), `chemtrail`, `energie steen`, `crystal heal`, `essential oil` (when paired with medical claim)

**Adjacent but allowed:**
- Yoga/meditation gear (the mat, not "cure your anxiety")
- General mindfulness apps (the tool, not the cure)

### A.9 Children-targeted age-sensitive

**Why:** AVG strict on minor data; advertising to minors regulated.

**Stems:** any niche that primarily targets <16 audience with personal-tracker or "join community" mechanics (toy reviews for parents are fine; "best apps for 10-year-olds" with sign-ups is not)

### A.10 Trademark/IP-violation patterns

**Why:** legal risk; SIDN/EUIPO arbitration; affiliate-network compliance.

**Stems:** any candidate where the proposed `topic` or `topic_slug` *is* a registered trademark in EUIPO Nice classes 9/35/41/42. Discovery agent runs TMview pre-check; on hit, hard block.

### A.11 Already-killed topics

If `topic_slug` exists in `kills.niche_id → niches.topic_slug` with a non-"manual_operator_kill" reason, the candidate is rejected without re-scoring. (Operator-killed niches *can* be re-proposed manually.)

### A.12 Active topics

If `topic_slug` matches an active niche (`niches.state in ('validating','building','mature','promoted')`), reject as duplicate.

---

## B. Avoid list — saturated affiliate graveyards

These categories are not regulated or unsafe, but their **affiliate-graveyard kill rates are documented as extreme** in operator post-mortems (Authority Hacker discontinuing TASS in 2024, Income School Project 24 cohort data, Empire Flippers transaction patterns). Score-down, don't outright block.

| Category | Why it's a graveyard |
|---|---|
| Fast fashion | Race to the bottom; brand sites dominate; 1–2% commission with high return rates |
| Generic fitness | "Yoga mat reviews" type content has near-zero CTR; Amazon/Bol mega-sites won |
| Phone accessories (cases, chargers, screen protectors) | Commoditised; users buy on Bol direct; no editorial moat |
| Fidget toys / trend-cycle items | Lifecycle 6–18 weeks; cannot build authority before category dies |
| Weight-loss products | Adjacent to YMYL, low-quality affiliate offers, frequent compliance issues |
| Generic dropship trinkets ("cool gadgets") | Echo of AliExpress; SEO-saturated by hundreds of identical sites |
| "Best AI tools 2026" roundups | Saturated past parody; new entries appear weekly; commoditised content |
| Generic "best VPN" affiliate | Entrenched incumbents with €10M+ marketing budgets; impossible new-entry economics |
| Crypto exchange affiliate | Regulatory shifting; trust signals weak; YMYL-adjacent |
| Generic kitchen gadgets ("best blender") | Coolblue/Bol/Amazon dominate; thin SEO margins |
| Travel "best [destination]" content | Saturated by Booking/Tripadvisor; affiliate cookies cleared by Apple ITP/Safari |
| Make-money-online affiliate | Race-to-the-bottom; suspect offers; compliance risk |

**Scoring impact:** category match → `avoid_list_inverse_score` set to 0 (with weight 10%, this is up to a 10-point composite drag). Multiple-category match drags further.

### B.1 Borderline categories — operator can override

Some "avoid" categories have legitimate sub-niches with defensible moats. Operator can mark them as "operator_override_allowed" in `tenants.config.kill_list_overrides`:

- "Best blender" is graveyard; "professional cold-press juice setup for raw food prep" is a real niche
- "Best running shoes" is graveyard; "running shoes for runners with high arches and pronation" is a real niche
- "Best VPN" is graveyard; "VPN setup for Synology NAS in NL" is defensible

Pattern: the niche becomes interesting when it has a *specific persona* + *specific product use case*. Generic top-level "best X" is the trap.

---

## C. How the agents use this list

### Discovery Agent

- Pre-filter: every surfaced candidate runs through `matchKillList(topic, related_keywords)` from `packages/shared/src/killList.ts`
- If §A match: candidate is not written to `niche_candidates`; logged with reason
- If §B match: candidate is written with `kill_list_match={'category': '...', 'severity': 'avoid'}` for the Scoring Agent to penalise

### Scoring Agent

- Re-runs the kill-list check (defense in depth)
- §A match → `total_score=0`, `block_reason` set, no rubric computed
- §B match → criterion 7 (avoid-list inverse) scored 0

### Operator triage UI

- §A-matched candidates do not appear (they aren't written)
- §B-matched candidates appear with a red badge and the matched category surfaced

---

## D. Maintaining the list

This list lives in `packages/shared/src/killList.ts` as the canonical source. The `.md` doc here mirrors it.

**Adding entries:**
1. PR titled `chore(kill-list): add [category]`
2. Update both this `.md` and the TS file in the same PR
3. Add a test case in `packages/shared/tests/killList.test.ts`
4. Operator approves PR

**Removing entries:** very rare. Document why in PR description. The bar for removal is high.

**Per-tenant overrides:**
- `tenants.config.kill_list_overrides: ['weight-loss-for-postpartum-women', ...]`
- Only the listed *specific topic slug* gets exempted from §B
- Section §A is **never** overridable per tenant. YMYL, gambling, weapons, etc. stay blocked regardless of config.

---

## E. Forbidden phrasing in any approved niche

Even on approved niches, the Content Agent and Claim Verifier reject pages containing:

- Medical claims ("cures," "treats," "prevents," "heals," "alternative for medication")
- Financial advice ("you should buy," "guaranteed return," specific investment recommendation)
- "Lose X kg" claims of any kind
- "Hack," "cheat," "loophole," "secret" framing of legal-grey-area activities
- Counterfeit-encouraging language ("dupe," "lookalike that's just as good as [brand]" without legitimate substitute reasoning)
- Comparison schemas claiming "best" without sourced evidence

These are runtime checks in the page-publish pipeline. Violations block the publish.

---

## F. Reference

This kill list is informed by:
- NL legislation: Geneesmiddelenwet, Wft, Tabaks- en Rookwarenwet, Wet wapens en munitie, Wet kansspelen, AVG/UAVG
- EU regulations: EU 1924/2006 (health claims), MDR (medical devices), EU AI Act Article 50
- Affiliate network ToS: Bol Partner, Awin, Daisycon, Digistore24, Impact
- Practitioner post-mortems: Authority Hacker (TASS discontinuation, 2024), Income School cohort data (Increasing.com analysis April 2024), Empire Flippers transaction notes

Review the list at the end of every 4th quarter, or whenever a regulator publishes new guidance.
