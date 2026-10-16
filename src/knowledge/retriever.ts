import type { KnowledgeChunk, RetrievalResult } from './types.js';

// Words players use, expanded to the headings in knowledge/T.C.P_DOCUMENTATION.md. Words that already
// appear in a heading (lean, precision, recoil, easing...) need no entry; mapping them would pull every
// question that mentions them toward one section.
const aliasMap: Record<string, string> = {
  ar: 'Anti-Recoil',
  'anti recoil': 'Anti-Recoil',
  'stable core': 'Anti-Recoil',
  vert: 'Vertical Recoil',
  vertical: 'Vertical Recoil',
  hori: 'Horizontal Recoil',
  horizontal: 'Horizontal Recoil',
  ads: 'ADS Accuracy',
  'auto aim': 'Automatic Aim',
  reset: 'Factory Reset',
  calibrate: 'Calibrate Recoil',
  calibration: 'Calibrate Recoil',
  'turn strenght': 'Turn Strength',
  'turn strengh': 'Turn Strength',
  'turning strength': 'Turn Strength',
  turnstrength: 'Turn Strength',
  firesens: 'Fire Sens',
  profile: 'ADS Profiles',
  profiles: 'ADS Profiles',
  dropshot: 'Drop Shot',
  crouchshot: 'Crouch Shot',
  moonwalk: 'Auto Movement',
  adz: 'Anti Deadzone',
  mie: 'Motion Intel',
  'motion intelligence': 'Motion Intel',
  license: 'Licence Unlock',
  licence: 'Licence Unlock',
  unlock: 'Licence Unlock',
  key: 'Licence Unlock',
  generate: 'Licence Unlock',
  trial: 'Free Trial',
  locked: 'Licence Unlock',
};

export interface KnowledgeRetriever {
  search(query: string, limit?: number): Promise<RetrievalResult[]>;
}

export class KeywordRetriever implements KnowledgeRetriever {
  constructor(private readonly chunks: KnowledgeChunk[]) {}

  async search(query: string, limit = 5): Promise<RetrievalResult[]> {
    const tokens = normalizeQuery(query);

    const scored = this.chunks
      .map((chunk) => {
        const score = scoreChunk(chunk, tokens);
        return score > 0 ? { chunk, score } : null;
      })
      .filter(Boolean) as RetrievalResult[];

    return scored.sort((a, b) => b.score - a.score).slice(0, limit);
  }
}

function normalizeQuery(input: string): string[] {
  const lower = input.toLowerCase();
  let expanded = lower;

  for (const [alias, replacement] of Object.entries(aliasMap)) {
    expanded = expanded.replace(new RegExp(`\\b${escapeRegex(alias)}\\b`, 'g'), replacement.toLowerCase());
  }

  // Matching is by substring, so a two-letter word like "do" would match "down" anywhere. Numbers stay
  // (players ask about "180").
  const tokens = (expanded.match(/[a-z0-9]+/g) ?? []).filter(
    (token) => !STOP_WORDS.has(token) && (token.length >= 3 || /^\d+$/.test(token)),
  );
  return tokens;
}

function scoreChunk(chunk: KnowledgeChunk, tokens: string[]): number {
  const haystack = [
    chunk.section,
    chunk.subsection ?? '',
    chunk.heading,
    chunk.content,
    chunk.keywords.join(' '),
  ]
    .join(' ')
    .toLowerCase();

  let score = 0;

  for (const token of tokens) {
    if (haystack.includes(token)) score += 2;
    if (chunk.section.toLowerCase().includes(token) || chunk.heading.toLowerCase().includes(token)) score += 4;
  }

  if (tokens.some((token) => chunk.section.toLowerCase().includes(token))) score += 10;
  if (tokens.some((token) => chunk.heading.toLowerCase().includes(token))) score += 8;

  // Two words of the question side by side in the heading ("anti deadzone", "fire sens", "lean spam")
  // is a strong sign this is the section being asked about.
  const heading = chunk.heading.toLowerCase().replace(/[^a-z0-9]+/g, ' ');
  for (let index = 0; index + 1 < tokens.length; index += 1) {
    if (heading.includes(`${tokens[index]} ${tokens[index + 1]}`)) score += 12;
  }

  // Favour the recoil sections for recoil questions only; applied to every question, this would make
  // any section that mentions recoil a match for unrelated questions.
  const recoilQuestion = tokens.some((token) => ['vertical', 'horizontal', 'recoil'].includes(token));
  if (score > 0 && recoilQuestion && ['vertical', 'horizontal', 'anti-recoil', 'anti recoil'].some((term) => haystack.includes(term))) {
    score += 5;
  }

  return score;
}

const STOP_WORDS = new Set([
  'the', 'what', 'does', 'how', 'why', 'can', 'is', 'a', 'an', 'my', 'it', 'for', 'and', 'or', 'to', 'of', 'in', 'on',
  'you', 'your', 'with', 'this', 'that', 'when', 'should', 'would', 'keeps', 'not', 'doesnt', 'dont', 'get', 'has', 'have',
]);

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
