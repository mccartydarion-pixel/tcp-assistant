import { KnowledgeService } from '../knowledge/knowledgeService.js';
import { isOpenAiConfigured, openai } from '../services/openai.js';
import { logger } from '../utils/logger.js';
import { buildTCPPrompt, type ConversationTurn } from './promptBuilder.js';
import type { FollowUpIntent, TuningState } from './conversationMemory.js';
import { extractQuestionDetails, normalizeUserQuestion } from './question.js';
import { buildRetrievalQuery } from './retrievalQuery.js';

export class AssistantService {
  constructor(private readonly knowledge: KnowledgeService) {}

  async answer(
    question: string,
    conversationHistory: ConversationTurn[] = [],
    botId?: string,
    tuningState: TuningState = {},
    followUpIntent: FollowUpIntent = null,
  ): Promise<string> {
    const normalizedQuestion = normalizeUserQuestion(question, botId);
    const details = extractQuestionDetails(normalizedQuestion);
    logger.info(`[TCP AI] Question received: ${normalizedQuestion}`);
    logger.info(`[TCP AI] Conversation turns: ${conversationHistory.length}`);
    const retrievalQuery = buildRetrievalQuery(normalizedQuestion, details, tuningState);
    logger.info(`[TCP Retrieval] Query: ${retrievalQuery}`);
    const matches = await this.knowledge.search(retrievalQuery, 5);
    logger.info(`[TCP Retrieval] Found ${matches.length} knowledge chunks`);

    if (followUpIntent === 'TESTING') {
      return 'Sounds good. Keep the weapon, optic, and distance the same for the test. When you are done, tell me if it still climbs, pulls down, or feels centered.';
    }
    if (followUpIntent === 'RESOLVED') {
      return 'Perfect. Save that value. We can tune Horizontal or ADS separately if you need to.';
    }
    if (followUpIntent === 'TEST_RESULT' && tuningState.vertical !== undefined) {
      if (tuningState.currentSymptom === 'CLIMBING') {
        return `Since ${tuningState.vertical} is still climbing, try ${tuningState.vertical + 1} next. Keep Horizontal unchanged so we are testing one variable.`;
      }
      if (tuningState.currentSymptom === 'PULLING_DOWN' && tuningState.previousVertical !== undefined) {
        return `You have crossed the balance point. Move Vertical back toward ${tuningState.previousVertical} and retest.`;
      }
      if (tuningState.currentSymptom === 'STABLE') {
        return `Perfect. Keep Vertical at ${tuningState.vertical} and save that value.`;
      }
    }

    if (!isOpenAiConfigured() || !openai) {
      return "T.C.P. Assistant's AI service is not configured right now. Please provide your weapon, distance, current settings, and symptom so the support team can help.";
    }

    const prompt = buildTCPPrompt({ question: normalizedQuestion, retrievedChunks: matches, conversationHistory, details, tuningState });

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
