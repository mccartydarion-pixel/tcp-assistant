import type { KnowledgeChunk, RetrievalResult } from './types.js';

const aliasMap: Record<string, string> = {
  ar: 'Anti Recoil',
  'anti recoil': 'Anti Recoil',
  vert: 'Vertical Recoil',
  vertical: 'Vertical Recoil',
  hori: 'Horizontal Recoil',
  horizontal: 'Horizontal Recoil',
  'ads sens': 'ADS Sens',
  ads: 'ADS Accuracy',
  'auto aim': 'Automatic Aim',
  lean: 'Follow Lean',
  'stable core': 'Stable Core Anti-Recoil',
  reset: 'Factory Reset',
  recoil: 'Stable Core Anti-Recoil',
  precision: 'Precision Hold',
  'follow lean': 'Follow Lean',
  'auto run': 'Auto Run',
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

  const tokens = (expanded.match(/[a-z0-9]+/g) ?? []).filter((token) => !STOP_WORDS.has(token));
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

  if (['vertical', 'horizontal', 'stable core', 'precision hold', 'anti recoil'].some((term) => haystack.includes(term))) {
    score += 5;
  }

  return score;
}

const STOP_WORDS = new Set(['the', 'what', 'does', 'how', 'why', 'can', 'is', 'a', 'an', 'my', 'it', 'for', 'and', 'or', 'to', 'of', 'in', 'on']);

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
