import { DocumentLoader } from './documentLoader.js';
import { DocumentParser } from './documentParser.js';
import { KeywordRetriever } from './retriever.js';
import type { AssistantResponse, KnowledgeChunk, RetrievalResult } from './types.js';
import { logger } from '../utils/logger.js';

export class KnowledgeService {
  private loader = new DocumentLoader();
  private parser = new DocumentParser();
  private chunks: KnowledgeChunk[] = [];
  private retriever: KeywordRetriever | null = null;

  async initialize(): Promise<void> {
    logger.info('[TCP Knowledge] Loading T.C.P_DOCUMENTATION.md');
    const text = await this.loader.load();
    this.chunks = this.parser.parse(text);
    this.retriever = new KeywordRetriever(this.chunks);
    logger.info(`[TCP Knowledge] Parsed ${this.chunks.length} sections and indexed ${this.chunks.length} chunks`);
  }

  get chunkCount(): number {
    return this.chunks.length;
  }

  async search(query: string, limit = 5): Promise<RetrievalResult[]> {
    if (!this.retriever) {
      await this.initialize();
    }
    return this.retriever!.search(query, limit);
  }

  async buildAnswer(question: string): Promise<AssistantResponse> {
    const matches = await this.search(question, 5);

    if (matches.length === 0) {
      return {
        content: "I don't have enough verified T.C.P. documentation to answer that confidently. Please provide more detail or open a support ticket.",
        confidence: 'LOW',
        sources: [],
        escalationRecommended: true,
      };
    }

    const best = matches[0].chunk;
    const sections = matches.map(({ chunk }) => `${chunk.section}${chunk.subsection ? ` > ${chunk.subsection}` : ''}`);

    if (/guarantee|perfect accuracy|every shot hits|zero sway|eliminate.*recoil/i.test(question)) {
      return {
        content: 'T.C.P. cannot guarantee perfect accuracy, zero sway, or every shot landing. The documentation clearly states that hardware, game behavior, network effects, and weapon recoil still require physical validation.',
        confidence: 'HIGH',
        sources: sections,
        escalationRecommended: false,
      };
    }

    if (/phase|pattern speed|v scale|h scale|profile/i.test(question)) {
      return {
        content: 'The current T.C.P. implementation uses Stable Core 2.0. Legacy phase/profile/pattern settings are retained for compatibility and are not part of the active recoil calculation.',
        confidence: 'HIGH',
        sources: sections,
        escalationRecommended: false,
      };
    }

    if (/vertical|horizontal/i.test(question)) {
      return {
        content: 'Vertical and Horizontal are the authoritative active recoil baselines in the current implementation. Small, controlled adjustments are recommended rather than large jumps.',
        confidence: 'HIGH',
        sources: sections,
        escalationRecommended: false,
      };
    }

    return {
      content: `Based on the current T.C.P. documentation, ${best.section} is the closest match for this topic. The current system is Stable Core 2.0 and the documentation is the authoritative source for technical answers.`,
      confidence: best.section.toLowerCase().includes('legacy') ? 'MEDIUM' : 'HIGH',
      sources: sections,
      escalationRecommended: false,
    };
  }
}
