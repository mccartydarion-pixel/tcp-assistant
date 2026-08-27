import { systemPrompt } from './systemPrompt.js';
import { KnowledgeService } from '../knowledge/knowledgeService.js';
import { isOpenAiConfigured, openai } from '../services/openai.js';
import { logger } from '../utils/logger.js';

export class AssistantService {
  constructor(private readonly knowledge: KnowledgeService) {}

  async answer(question: string): Promise<string> {
    const matches = await this.knowledge.search(question, 5);
    logger.info(`[TCP Retrieval] Found ${matches.length} knowledge chunks`);

    if (!isOpenAiConfigured() || !openai) {
      return (await this.knowledge.buildAnswer(question)).content;
    }

    const context = matches
      .map(({ chunk }) => `${chunk.section}${chunk.subsection ? ` > ${chunk.subsection}` : ''}\n${chunk.content}`)
      .join('\n\n');

    try {
      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        temperature: 0.2,
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: `Answer using only this documentation context. If it does not support the answer, say so.\n\nContext:\n${context || 'No matching documentation found.'}\n\nQuestion: ${question}`,
          },
        ],
      });
      const answer = response.choices[0]?.message.content?.trim();
      if (!answer) throw new Error('OpenAI returned an empty response');
      logger.info('[TCP AI] Response completed');
      return answer;
    } catch (error) {
      logger.error({ err: error }, '[TCP AI ERROR] Request failed');
      return (await this.knowledge.buildAnswer(question)).content;
    }
  }
}
