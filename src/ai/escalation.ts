export type EscalationIntent = 'OWNER_REQUEST' | 'ADMIN_REQUEST' | 'HUMAN_SUPPORT_REQUEST' | 'ESCALATION_REQUEST' | null;

export interface EscalationResult {
  intent: Exclude<EscalationIntent, null>;
  shouldNotify: boolean;
  key: string;
}

const informationalPattern = /\b(who\s+(?:is|owns?)|what\s+does|is\s+the)\s+(?:owner|admin|staff)\b/i;
const ownerPattern = /\b(?:get|ping|contact|notify|need|talk to|speak to|bring in|call)\s+(?:the\s+)?owner\b|\bowner\s+(?:in here|please)\b|^owner[!?.,\s]*$/i;
const adminPattern = /\b(?:get|ping|contact|need|talk to|speak to|bring in|call)\s+(?:an?\s+)?admin\b/i;
const humanPattern = /\b(?:need|want|talk to|speak to|get)\s+(?:a\s+)?(?:human|real person|someone)\b|\bhuman support\b|\b(?:escalate|more help)\b|\bcan someone help me\b/i;

export function detectEscalationIntent(question: string): EscalationIntent {
  if (informationalPattern.test(question)) return null;
  if (ownerPattern.test(question)) return 'OWNER_REQUEST';
  if (adminPattern.test(question)) return 'ADMIN_REQUEST';
  if (humanPattern.test(question)) return 'HUMAN_SUPPORT_REQUEST';
  return null;
}

export class EscalationService {
  private readonly cooldowns = new Map<string, number>();
  private readonly escalatedChannels = new Set<string>();
  private readonly ownerJoinedChannels = new Set<string>();
  private readonly cooldownMs: number;

  constructor(cooldownMs = 10 * 60 * 1000) {
    this.cooldownMs = cooldownMs;
  }

  request(guildId: string, channelId: string, userId: string, question: string): EscalationResult | null {
    const intent = detectEscalationIntent(question);
    if (!intent) return null;

    const key = `${guildId}:${channelId}:${userId}`;
    const now = Date.now();
    const lastNotified = this.cooldowns.get(key);
    if (lastNotified && now - lastNotified < this.cooldownMs) {
      return { intent, shouldNotify: false, key };
    }

    this.cooldowns.set(key, now);
    this.escalatedChannels.add(`${guildId}:${channelId}`);
    return { intent, shouldNotify: true, key };
  }

  isOwnerHandling(guildId: string, channelId: string): boolean {
    return this.ownerJoinedChannels.has(`${guildId}:${channelId}`);
  }

  isEscalated(guildId: string, channelId: string): boolean {
    return this.escalatedChannels.has(`${guildId}:${channelId}`);
  }

  markOwnerJoined(guildId: string, channelId: string): void {
    const channelKey = `${guildId}:${channelId}`;
    if (this.escalatedChannels.has(channelKey)) this.ownerJoinedChannels.add(channelKey);
  }
}
