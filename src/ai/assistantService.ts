import { KnowledgeService } from '../knowledge/knowledgeService.js';
import { isOpenAiConfigured, openai } from '../services/openai.js';
import { logger } from '../utils/logger.js';
import { buildTCPPrompt, type ConversationTurn } from './promptBuilder.js';
import { extractQuestionDetails, normalizeUserQuestion } from './question.js';

export class AssistantService {
  constructor(private readonly knowledge: KnowledgeService) {}

  async answer(question: string, conversationHistory: ConversationTurn[] = [], botId?: string): Promise<string> {
    const normalizedQuestion = normalizeUserQuestion(question, botId);
    const details = extractQuestionDetails(normalizedQuestion);
    logger.info(`[TCP AI] Question received: ${normalizedQuestion}`);
    logger.info(`[TCP AI] Conversation turns: ${conversationHistory.length}`);
    const matches = await this.knowledge.search(normalizedQuestion, 5);
    logger.info(`[TCP Retrieval] Found ${matches.length} knowledge chunks`);

    if (!isOpenAiConfigured() || !openai) {
      return "T.C.P. Assistant's AI service is not configured right now. Please provide your weapon, distance, current settings, and symptom so the support team can help.";
    }

    const prompt = buildTCPPrompt({ question: normalizedQuestion, retrievedChunks: matches, conversationHistory, details });

    try {
      logger.info('[TCP AI] Sending question + documentation to OpenAI');
      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        temperature: 0.2,
        messages: [
          { role: 'system', content: `${prompt.system}\n\n${prompt.context}` },
          ...prompt.history,
          { role: 'user', content: prompt.question },
        ],
      });
      const answer = response.choices[0]?.message.content?.trim();
      if (!answer) throw new Error('OpenAI returned an empty response');
      logger.info('[TCP AI] Response completed');
      return answer;
    } catch (error) {
      logger.error({ err: error }, '[TCP AI ERROR] Request failed');
      return "I couldn't reach the T.C.P. AI service right now. Please try again shortly.";
    }
  }
}
