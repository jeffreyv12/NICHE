// Single source of truth for the kill list — mirrors docs/KILL_LIST.md.
//
// The agents call matchKillList(topic, relatedKeywords) before scoring or
// surfacing a candidate. A §A match means hard reject. A §B match means
// `avoid_list_inverse_score = 0` in the rubric.
//
// IMPORTANT: this file is referenced from both apps/web (admin display +
// publish gates) and apps/scrapers (agent runtime). Changes must be made in
// PR with a corresponding test update in packages/shared/tests/killList.test.ts.

export type KillSeverity = 'hard_block' | 'avoid';

export interface KillCategory {
  /** Stable slug used in DB rows and analytics. */
  id: string;
  /** Human-readable category title (matches docs/KILL_LIST.md heading). */
  title: string;
  severity: KillSeverity;
  /** Lowercase stems matched as substrings against topic + related_keywords. */
  stems: readonly string[];
  /** Optional citation of the underlying law/policy. */
  reason: string;
}

// =============================================================================
// §A — Hard blocks
// =============================================================================

export const HARD_BLOCK_CATEGORIES: readonly KillCategory[] = [
  {
    id: 'ymyl_medical',
    title: 'YMYL — Regulated medical/health',
    severity: 'hard_block',
    reason: 'Geneesmiddelenwet + EU 1924/2006 (health claims)',
    stems: [
      'geneesmiddel', 'medicijn', 'medicat', 'pharma', 'recept', 'apotheek',
      'vitamine', 'supplement', 'voedingssupplement', 'kruid', 'homeopath',
      'cbd', 'cannabidiol', 'hennep', 'marihuana', 'wiet', 'thc',
      'psychedel', 'magic mushroom', 'truffles', 'paddo', 'kratom',
      'nootropic', 'smart drug', 'aankoop medicijn', 'online apotheek',
      'diabet', 'kanker', 'tumor', 'cardio', 'hartziekt', 'dementie',
      'alzheimer', 'depressi', 'angststoornis', 'bipolair', 'adhd', 'autism',
      'psoriasis', 'eczeem',
    ],
  },
  {
    id: 'financial_regulated',
    title: 'Financial advice / regulated',
    severity: 'hard_block',
    reason: 'Wet op het financieel toezicht (Wft); AFM license required',
    stems: [
      'beleg', 'belegging', 'crypto', 'bitcoin', 'ethereum', 'trading',
      'daytrading', 'forex', 'cfd', 'optie', 'derivat', 'hypothee', 'lening',
      'krediet', 'consumptief krediet', 'persoonlijke lening', 'verzeker',
      'pensioen', 'belasting', 'box 3', 'vermogensbeheer', 'financieel advies',
      'aandeel kopen', 'koers',
    ],
  },
  {
    id: 'gambling',
    title: 'Gambling / kansspelen',
    severity: 'hard_block',
    reason: 'Kansspelautoriteit license required',
    stems: [
      'gok', 'gokken', 'casino', 'online casino', 'kansspel', 'wedden',
      'bookmaker', 'sportweddenschap', 'bet', 'poker', 'roulette', 'blackjack',
      'slot', 'gokautomaat', 'lotto', 'bingo', 'tombola',
      // 'loterij' deliberately omitted — Staatsloterij content is allowed if no affiliate
    ],
  },
  {
    id: 'adult',
    title: 'Adult / 18+',
    severity: 'hard_block',
    reason: 'Bol Partner ToS + affiliate-network ToS + brand-safety',
    stems: ['porn', 'erotic', 'webcam adult', 'sex toy', 'adult dating'],
  },
  {
    id: 'tobacco_vape',
    title: 'Tobacco, vape, nicotine',
    severity: 'hard_block',
    reason: 'Tabaks- en Rookwarenwet',
    stems: [
      'sigaret', 'tabak', 'e-sigaret', 'vape', 'vaping', 'e-vloeistof',
      'e-juice', 'nicotine pouch', 'snus', 'shisha', 'waterpijp',
    ],
  },
  {
    id: 'weapons',
    title: 'Weapons',
    severity: 'hard_block',
    reason: 'Wet wapens en munitie; Bol Partner ToS prohibition',
    stems: [
      'vuurwapen', 'pistool', 'geweer', 'kruisboog',
      'combat knife', 'pepper spray', 'taser',
    ],
  },
  {
    id: 'counterfeits',
    title: 'Counterfeits, replicas, deceptive',
    severity: 'hard_block',
    reason: 'illegal; brand-safety; affiliate-network ToS',
    stems: [
      'replica', '1:1 watch', 'fake bag', 'aaa quality', 'dhgate',
      'aliexpress dupe', 'superfake', 'mirror image',
    ],
  },
  {
    id: 'pseudoscience',
    title: 'Pseudoscience / dangerous',
    severity: 'hard_block',
    reason: 'consumer-protection law; EU AI Act misinformation guardrails',
    stems: [
      'homeop', 'bach bloesem', 'aura heal', 'chakra heal', 'flat earth',
      'chemtrail', 'energie steen heal', 'crystal heal',
    ],
  },
];

// =============================================================================
// §B — Avoid list (saturated graveyards; score-down, don't outright block)
// =============================================================================

export const AVOID_CATEGORIES: readonly KillCategory[] = [
  {
    id: 'fast_fashion',
    title: 'Fast fashion',
    severity: 'avoid',
    reason: 'race to the bottom; brand sites dominate',
    stems: ['fast fashion', 'shein', 'temu fashion', 'goedkope kleding'],
  },
  {
    id: 'generic_fitness',
    title: 'Generic fitness',
    severity: 'avoid',
    reason: 'Amazon/Bol mega-sites won the category',
    stems: ['yoga mat review', 'fitness equipment', 'workout gear'],
  },
  {
    id: 'phone_accessories',
    title: 'Phone accessories',
    severity: 'avoid',
    reason: 'commoditised; no editorial moat',
    stems: ['phone case', 'screen protector', 'phone charger', 'telefoonhoesje'],
  },
  {
    id: 'fidget_trend',
    title: 'Fidget toys / trend-cycle items',
    severity: 'avoid',
    reason: '6-18 week lifecycle; no authority window',
    stems: ['fidget', 'pop it', 'trending toy'],
  },
  {
    id: 'weight_loss',
    title: 'Weight-loss products',
    severity: 'avoid',
    reason: 'YMYL-adjacent; low-quality offers; compliance risk',
    stems: ['afslank', 'weight loss', 'fat burner', 'diet pill', 'detox'],
  },
  {
    id: 'dropship_trinkets',
    title: 'Generic dropship trinkets',
    severity: 'avoid',
    reason: 'SEO-saturated by hundreds of identical sites',
    stems: ['cool gadgets', 'aliexpress finds', 'wish best'],
  },
  {
    id: 'ai_tool_roundups',
    title: 'AI tool roundups',
    severity: 'avoid',
    reason: 'commoditised; saturated past parody',
    stems: ['best ai tools', 'top ai tools 2026', 'ai tools roundup'],
  },
  {
    id: 'generic_vpn',
    title: 'Generic best-VPN affiliate',
    severity: 'avoid',
    reason: 'entrenched incumbents with €10M+ marketing budgets',
    stems: ['best vpn', 'vpn review', 'beste vpn'],
  },
  {
    id: 'crypto_exchange',
    title: 'Crypto exchange affiliate',
    severity: 'avoid',
    reason: 'regulatory shifting; weak trust signals; YMYL-adjacent',
    stems: ['crypto exchange', 'binance review', 'kraken review'],
  },
  {
    id: 'generic_kitchen_gadgets',
    title: 'Generic kitchen gadgets',
    severity: 'avoid',
    reason: 'Coolblue/Bol/Amazon dominate',
    stems: ['best blender', 'beste blender', 'top blender'],
  },
  {
    id: 'travel_best_destination',
    title: 'Travel "best [destination]" content',
    severity: 'avoid',
    reason: 'saturated by Booking/Tripadvisor; Safari ITP kills cookies',
    stems: ['best destination', 'top travel', 'beste reisbestemming'],
  },
  {
    id: 'mmo_affiliate',
    title: 'Make-money-online affiliate',
    severity: 'avoid',
    reason: 'race-to-the-bottom; compliance risk',
    stems: ['make money online', 'geld verdienen online', 'side hustle'],
  },
];

export const ALL_KILL_CATEGORIES: readonly KillCategory[] = [
  ...HARD_BLOCK_CATEGORIES,
  ...AVOID_CATEGORIES,
];

// =============================================================================
// matchKillList — the runtime check
// =============================================================================

export interface KillListMatch {
  category: KillCategory;
  matchedStem: string;
  matchedAgainst: 'topic' | 'topic_slug' | 'related_keyword';
  matchedValue: string;
}

export interface MatchKillListInput {
  topic: string;
  topicSlug?: string;
  relatedKeywords?: readonly string[];
  /** Operator overrides — specific topic_slugs exempt from §B (never from §A). */
  avoidOverrideSlugs?: readonly string[];
}

/**
 * Returns the first matching category, or null. Hard blocks checked first.
 *
 * Matching is substring-based on lowercased text. Stems are short
 * (`vape`, `geneesmiddel`) so this is intentionally aggressive.
 */
export function matchKillList(input: MatchKillListInput): KillListMatch | null {
  const haystacks: Array<{ kind: KillListMatch['matchedAgainst']; value: string }> = [
    { kind: 'topic', value: input.topic.toLowerCase() },
  ];
  if (input.topicSlug) {
    haystacks.push({ kind: 'topic_slug', value: input.topicSlug.toLowerCase() });
  }
  for (const kw of input.relatedKeywords ?? []) {
    haystacks.push({ kind: 'related_keyword', value: kw.toLowerCase() });
  }

  const overrideSet = new Set(
    (input.avoidOverrideSlugs ?? []).map((s) => s.toLowerCase()),
  );

  // Hard blocks first
  for (const category of HARD_BLOCK_CATEGORIES) {
    const match = findStemMatch(category, haystacks);
    if (match) return match;
  }

  // Avoid list — skip if this exact slug is in the operator override list
  const slugLower = input.topicSlug?.toLowerCase();
  if (slugLower && overrideSet.has(slugLower)) {
    return null;
  }
  for (const category of AVOID_CATEGORIES) {
    const match = findStemMatch(category, haystacks);
    if (match) return match;
  }

  return null;
}

function findStemMatch(
  category: KillCategory,
  haystacks: Array<{ kind: KillListMatch['matchedAgainst']; value: string }>,
): KillListMatch | null {
  for (const stem of category.stems) {
    const stemLower = stem.toLowerCase();
    for (const h of haystacks) {
      if (h.value.includes(stemLower)) {
        return {
          category,
          matchedStem: stem,
          matchedAgainst: h.kind,
          matchedValue: h.value,
        };
      }
    }
  }
  return null;
}
