import { KnowledgeService } from '../knowledge/knowledgeService.js';
import { isOpenAiConfigured, openai } from '../services/openai.js';
import { logger } from '../utils/logger.js';
import { buildTCPPrompt, type ConversationTurn } from './promptBuilder.js';
import type { FollowUpIntent, TuningState } from './conversationMemory.js';
import { recordedPullReply } from './pullFollowUp.js';
import { extractQuestionDetails, normalizeUserQuestion } from './question.js';
import { buildRetrievalQuery } from './retrievalQuery.js';
import { extractUnansweredMarker } from './unansweredMarker.js';

export interface AssistantAnswer {
  text: string;
  /** True when the documentation could not answer the question, so the owner should hear about it. */
  unanswered: boolean;
  /** The documentation sections the answer was based on, closest first. */
  sources: string[];
}

export class AssistantService {
  constructor(private readonly knowledge: KnowledgeService) {}

  async answer(
    question: string,
    conversationHistory: ConversationTurn[] = [],
    botId?: string,
    tuningState: TuningState = {},
    followUpIntent: FollowUpIntent = null,
  ): Promise<string> {
    return (await this.answerDetailed(question, conversationHistory, botId, tuningState, followUpIntent)).text;
  }

  async answerDetailed(
    question: string,
    conversationHistory: ConversationTurn[] = [],
    botId?: string,
    tuningState: TuningState = {},
    followUpIntent: FollowUpIntent = null,
    /** The channels the member can see (describeServerForAssistant), so the answer can link them. */
    serverMap?: string,
  ): Promise<AssistantAnswer> {
    const normalizedQuestion = normalizeUserQuestion(question, botId);
    const details = extractQuestionDetails(normalizedQuestion);
    logger.info(`[TCP AI] Question received: ${normalizedQuestion}`);
    logger.info(`[TCP AI] Conversation turns: ${conversationHistory.length}`);
    const retrievalQuery = buildRetrievalQuery(normalizedQuestion, details, tuningState);
    logger.info(`[TCP Retrieval] Query: ${retrievalQuery}`);
    const matches = await this.knowledge.search(retrievalQuery, 5);
    logger.info(`[TCP Retrieval] Found ${matches.length} knowledge chunks`);
    const sources = matches.map(({ chunk }) => `${chunk.section}${chunk.subsection ? ` > ${chunk.subsection}` : ''}`);
    const fixed = (text: string): AssistantAnswer => ({ text, unanswered: false, sources });

    if (followUpIntent === 'TESTING') {
      return fixed('Sounds good. Keep the weapon, optic, and distance the same for the test. When you are done, tell me if it still climbs, pulls down, or feels centered.');
    }
    // On a recorded Workshop pull, Vertical and Horizontal Recoil are locked: those replies tune Scale Y.
    const pullReply = recordedPullReply(followUpIntent, tuningState);
    if (pullReply) {
      return fixed(pullReply);
    }
    if (followUpIntent === 'RESOLVED') {
      return fixed('Perfect. Save that value. We can tune Horizontal or ADS separately if you need to.');
    }
    if (followUpIntent === 'TEST_RESULT' && tuningState.vertical !== undefined && !tuningState.onRecordedPull) {
      if (tuningState.currentSymptom === 'CLIMBING') {
        return fixed(`Since ${tuningState.vertical} is still climbing, try ${tuningState.vertical + 1} next. Keep Horizontal unchanged so we are testing one variable.`);
      }
      if (tuningState.currentSymptom === 'PULLING_DOWN' && tuningState.previousVertical !== undefined) {
        return fixed(`You have crossed the balance point. Move Vertical back toward ${tuningState.previousVertical} and retest.`);
      }
      if (tuningState.currentSymptom === 'STABLE') {
        return fixed(`Perfect. Keep Vertical at ${tuningState.vertical} and save that value.`);
      }
    }

    if (!isOpenAiConfigured() || !openai) {
      return fixed("T.C.P. Assistant's AI service is not configured right now. Please provide your weapon, distance, current settings, and symptom so the support team can help.");
    }

    const prompt = buildTCPPrompt({ question: normalizedQuestion, retrievedChunks: matches, conversationHistory, details, tuningState, serverMap });

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
      const raw = response.choices[0]?.message.content?.trim();
      if (!raw) throw new Error('OpenAI returned an empty response');
      const { text, flagged } = extractUnansweredMarker(raw);
      logger.info(`[TCP AI] Response completed${flagged ? ' (not covered by the documentation)' : ''}`);
      return { text: text || "I'm not sure about that one. Could you give me a bit more detail?", unanswered: flagged || matches.length === 0, sources };
    } catch (error) {
      logger.error({ err: error }, '[TCP AI ERROR] Request failed');
      return fixed("I couldn't reach the T.C.P. AI service right now. Please try again shortly.");
    }
  }
}
