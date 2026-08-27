import { EscalationService, detectEscalationIntent } from './escalation.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { normalizeUserQuestion } from './question.js';

export type SpecialIntent = 'HUMAN_ESCALATION' | 'OWNER_REQUEST' | 'ADMIN_REQUEST' | 'HUMAN_SUPPORT_REQUEST';

export function detectSpecialIntent(question: string): SpecialIntent | null {
  const intent = detectEscalationIntent(question);
  if (!intent) return null;
  return 'HUMAN_ESCALATION';
}

export interface SpecialIntentDecision {
  intent: SpecialIntent;
  shouldNotify: boolean;
  key: string;
}

export class SpecialIntentRouter {
  private readonly escalation: EscalationService;

  constructor(cooldownMs?: number) {
    this.escalation = new EscalationService(cooldownMs);
  }

  check(guildId: string, channelId: string, userId: string, question: string): SpecialIntentDecision | null {
    const normalizedQuestion = normalizeUserQuestion(question);
    const intent = detectSpecialIntent(normalizedQuestion);
    if (!intent) return null;

    const escalation = this.escalation.request(guildId, channelId, userId, normalizedQuestion);
    if (!escalation) return null;
    logger.info(`[TCP Intent] ${intent} detected`);
    return { intent, shouldNotify: escalation.shouldNotify, key: escalation.key };
  }

  isEscalated(guildId: string, channelId: string): boolean {
    return this.escalation.isEscalated(guildId, channelId);
  }

  isOwnerHandling(guildId: string, channelId: string): boolean {
    return this.escalation.isOwnerHandling(guildId, channelId);
  }

  markOwnerJoined(guildId: string, channelId: string): void {
    this.escalation.markOwnerJoined(guildId, channelId);
  }

  ownerResponse(duplicate: boolean): { content: string; allowedMentions?: { users: string[] } } {
    if (duplicate) {
      return { content: 'The owner has already been notified for this conversation. Add any extra details here and they will be available when reviewed.' };
    }
    if (!env.OWNER_USER_ID) {
      logger.warn('[TCP Escalation WARNING] OWNER_USER_ID not configured.');
      return { content: 'I can escalate this once the owner account is configured. Please leave the issue details here for now.' };
    }
    logger.info('[TCP Escalation] Owner configured: YES');
    return {
      content: `Owner requested. I've notified <@${env.OWNER_USER_ID}> that you need assistance.\n\nPlease leave a quick description of the issue so they have context when they review this.`,
      allowedMentions: { users: [env.OWNER_USER_ID] },
    };
  }
}
