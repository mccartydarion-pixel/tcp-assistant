import type { ConversationTurn } from './promptBuilder.js';
import type { UserQuestionDetails } from './question.js';

export type FollowUpIntent = 'ACKNOWLEDGEMENT' | 'TESTING' | 'TEST_RESULT' | 'MORE_HELP' | 'RESOLVED' | 'CONFUSED' | null;

export interface TuningState {
  vertical?: number;
  horizontal?: number;
  adsSens?: number;
  precision?: number;
  response?: number;
  easing?: number;
  weapon?: string;
  optic?: string;
  distanceMeters?: number;
  currentSymptom?: 'CLIMBING' | 'PULLING_DOWN' | 'DRIFTING_LEFT' | 'DRIFTING_RIGHT' | 'BOUNCING' | 'SHAKY' | 'SLUGGISH' | 'TOO_FAST' | 'STABLE';
  lastRecommendation?: string;
  previousVertical?: number;
  previousHorizontal?: number;
  waitingForTestResult?: boolean;
  resolved?: boolean;
}

export interface ConversationSession {
  key: string;
  turns: ConversationTurn[];
  tuning: TuningState;
  lastActivity: number;
  active: boolean;
}

export class ConversationMemory {
  private readonly sessions = new Map<string, ConversationSession>();

  constructor(private readonly normalTtlMs = 45 * 60 * 1000, private readonly ticketTtlMs = 24 * 60 * 60 * 1000) {}

  key(guildId: string, channelId: string, userId: string): string {
    return `${guildId}:${channelId}:${userId}`;
  }

  get(guildId: string, channelId: string, userId: string, isTicket = false): ConversationSession | undefined {
    const key = this.key(guildId, channelId, userId);
    const session = this.sessions.get(key);
    if (!session) return undefined;
    const ttl = isTicket ? this.ticketTtlMs : this.normalTtlMs;
    if (Date.now() - session.lastActivity > ttl) {
      this.sessions.delete(key);
      console.info(`[TCP Session] Session expired: ${key}`);
      return undefined;
    }
    return session;
  }

  hasActive(guildId: string, channelId: string, userId: string, isTicket = false): boolean {
    return this.get(guildId, channelId, userId, isTicket)?.active === true;
  }

  getOrCreate(guildId: string, channelId: string, userId: string, isTicket = false): ConversationSession {
    const existing = this.get(guildId, channelId, userId, isTicket);
    if (existing) {
      existing.active = true;
      existing.lastActivity = Date.now();
      console.info(`[TCP Session] Session resumed: ${existing.key}`);
      return existing;
    }
    const session: ConversationSession = {
      key: this.key(guildId, channelId, userId),
      turns: [],
      tuning: {},
      lastActivity: Date.now(),
      active: true,
    };
    this.sessions.set(session.key, session);
    console.info(`[TCP Session] Session created: ${session.key}`);
    return session;
  }

  updateFromQuestion(session: ConversationSession, details: UserQuestionDetails, question: string): FollowUpIntent {
    const followUp = detectFollowUpIntent(question);
    const previous = session.tuning;
    if (details.vertical !== undefined && previous.vertical !== undefined && details.vertical !== previous.vertical) {
      previous.previousVertical = previous.vertical;
    }
    if (details.horizontal !== undefined && previous.horizontal !== undefined && details.horizontal !== previous.horizontal) {
      previous.previousHorizontal = previous.horizontal;
    }
    Object.assign(previous, {
      vertical: details.vertical ?? previous.vertical,
      horizontal: details.horizontal ?? previous.horizontal,
      adsSens: details.adsSens ?? previous.adsSens,
      precision: details.precision ?? previous.precision,
      response: details.response ?? previous.response,
      easing: details.easing ?? previous.easing,
      weapon: details.weapon ?? previous.weapon,
      optic: details.optic ?? previous.optic,
      distanceMeters: details.distance ?? previous.distanceMeters,
    });
    if (details.symptom === 'upward_climb') previous.currentSymptom = 'CLIMBING';
    if (details.symptom === 'left_pull') previous.currentSymptom = 'DRIFTING_LEFT';
    if (details.symptom === 'right_pull') previous.currentSymptom = 'DRIFTING_RIGHT';
    if (details.symptom === 'unstable_micro_aim') previous.currentSymptom = 'SHAKY';
    if (followUp === 'TEST_RESULT') {
      if (/still\s+(?:going\s+)?up|climb|upward/i.test(question)) previous.currentSymptom = 'CLIMBING';
      else if (/pull(?:ing)?\s+down/i.test(question)) previous.currentSymptom = 'PULLING_DOWN';
      else if (/pull(?:ing)?\s+left/i.test(question)) previous.currentSymptom = 'DRIFTING_LEFT';
      else if (/pull(?:ing)?\s+right/i.test(question)) previous.currentSymptom = 'DRIFTING_RIGHT';
      else if (/shaky|unstable/i.test(question)) previous.currentSymptom = 'SHAKY';
      else if (/better|centered|stable/i.test(question)) previous.currentSymptom = 'STABLE';
    }
    if (followUp === 'RESOLVED') {
      previous.resolved = true;
      previous.waitingForTestResult = false;
      console.info(`[TCP Session] Session resolved: ${session.key}`);
    }
    return followUp;
  }

  record(session: ConversationSession, question: string, answer: string): void {
    session.turns.push(
      { role: 'user', content: question },
      { role: 'assistant', content: answer },
    );
    session.turns = session.turns.slice(-8);
    session.lastActivity = Date.now();
    const recommendation = answer.match(/(?:try|move|increase|decrease|drop|raise|lower)\s+[^.!?]+/i)?.[0];
    if (recommendation) {
      session.tuning.lastRecommendation = recommendation;
      session.tuning.waitingForTestResult = true;
      const verticalRecommendation = recommendation.match(/\bvertical\s+(?:(?:to|at)\s+)?(-?\d+(?:\.\d+)?)/i);
      if (verticalRecommendation?.[1]) {
        const nextVertical = Number(verticalRecommendation[1]);
        if (session.tuning.vertical !== undefined && session.tuning.vertical !== nextVertical) {
          session.tuning.previousVertical = session.tuning.vertical;
        }
        session.tuning.vertical = nextVertical;
      }
      const horizontalRecommendation = recommendation.match(/\bhorizontal\s+(?:(?:to|at)\s+)?(-?\d+(?:\.\d+)?)/i);
      if (horizontalRecommendation?.[1]) {
        const nextHorizontal = Number(horizontalRecommendation[1]);
        if (session.tuning.horizontal !== undefined && session.tuning.horizontal !== nextHorizontal) {
          session.tuning.previousHorizontal = session.tuning.horizontal;
        }
        session.tuning.horizontal = nextHorizontal;
      }
      console.info(`[TCP Session] Waiting for test result: ${session.key}`);
    }
  }

  reset(guildId: string, channelId: string, userId: string): void {
    this.sessions.delete(this.key(guildId, channelId, userId));
  }
}

export function detectFollowUpIntent(question: string): FollowUpIntent {
  if (/\b(?:fixed|perfect|that worked|it's good now|problem solved|all good)\b/i.test(question)) return 'RESOLVED';
  if (/\b(?:still|now|that|it)\b.*\b(?:climb(?:ing)?|going up|pull(?:ing)? down|pull(?:ing)? left|pull(?:ing)? right|shaky|better|stable)\b/i.test(question)) return 'TEST_RESULT';
  if (/\b(?:test|try)\s+(?:it|again)|\b(?:i'll|ill|okay|ok|bet|got it)\b.*\b(?:test|try)\b/i.test(question)) return 'TESTING';
  if (/\b(?:okay|ok|got it|bet|thanks|thank you|sounds good)\b/i.test(question)) return 'ACKNOWLEDGEMENT';
  if (/\b(?:what next|more help|help me|confused|don't understand)\b/i.test(question)) return 'MORE_HELP';
  if (/\b(?:confused|don't get|not sure)\b/i.test(question)) return 'CONFUSED';
  return null;
}
