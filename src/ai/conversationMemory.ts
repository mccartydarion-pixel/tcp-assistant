import type { ConversationTurn } from './promptBuilder.js';
import { clampScale, type UserQuestionDetails } from './question.js';

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
  /**
   * T.C.P Premium: a Weapon Workshop slot with a recorded pull is selected, so the recorded pull fires and
   * Vertical and Horizontal Recoil are locked. That gun is tuned with Scale Y and Scale X instead.
   */
  onRecordedPull?: boolean;
  /** The Workshop slot the player named, W1 to W4. */
  workshopSlot?: string;
  /** The recorded pull as the home screen shows it on a pull (V28 H4), kept apart from Vertical and Horizontal. */
  pullVertical?: number;
  pullHorizontal?: number;
  /** Workshop Scale Y (up/down strength) and Scale X (sideways), 50 to 150%, default 100. */
  scaleY?: number;
  scaleX?: number;
  previousScaleY?: number;
  previousScaleX?: number;
  /**
   * What the player's tests of Scale Y showed on this slot: the highest value that still climbed and the lowest
   * that pulled down. The balance point is between them, so the fixed replies never suggest a value outside.
   */
  scaleYClimbs?: number;
  scaleYPullsDown?: number;
  waitingForTestResult?: boolean;
  resolved?: boolean;
}

type Symptom = NonNullable<TuningState['currentSymptom']>;

/** What belongs to one Workshop slot, dropped when the player names a different slot. */
const SLOT_FIELDS = ['scaleY', 'scaleX', 'previousScaleY', 'previousScaleX', 'pullVertical', 'pullHorizontal', 'scaleYClimbs', 'scaleYPullsDown'] as const;

/** What a REDO makes out of date: the slot gets a new pull, so earlier tests of Scale Y no longer apply. */
const PULL_TEST_FIELDS = ['previousScaleY', 'scaleYClimbs', 'scaleYPullsDown', 'pullVertical', 'pullHorizontal'] as const;

// The player says the slot was recorded again.
const REDONE = /\b(?:redid|re-?did|re-?recorded|did\s+(?:a|the)\s+redo|after\s+(?:the|a)\s+redo|redo\s+(?:is\s+)?(?:done|complete|finished)|recorded\s+(?:it|that\s+slot|the\s+slot|w[1-4])\s+again)\b/i;

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
    let followUp = detectFollowUpIntent(question);
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
    updateRecordedPull(previous, details, question);
    // On a recorded pull, once a change has been suggested, the plain answers to "does it still climb, pull down,
    // or feel centered?" ("it still climbs", "it pulls down now", "feels centered") are test results too. Off a
    // pull detectFollowUpIntent alone decides, as before.
    if ((followUp === null || followUp === 'ACKNOWLEDGEMENT') && previous.onRecordedPull && previous.waitingForTestResult && testResultSymptom(question)) {
      followUp = 'TEST_RESULT';
    }
    let reported = detailSymptom(details.symptom);
    if (followUp === 'TEST_RESULT') reported = testResultSymptom(question) ?? reported;
    if (reported) previous.currentSymptom = reported;
    if (reported && previous.onRecordedPull) updateScaleYTests(previous, reported);
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
      const scaleYRecommendation = recommendation.match(/\bscale\s*y\s+(?:(?:to|at)\s+)?(\d+(?:\.\d+)?)/i);
      if (scaleYRecommendation?.[1]) setScale(session.tuning, 'scaleY', 'previousScaleY', Number(scaleYRecommendation[1]));
      const scaleXRecommendation = recommendation.match(/\bscale\s*x\s+(?:(?:to|at)\s+)?(\d+(?:\.\d+)?)/i);
      if (scaleXRecommendation?.[1]) setScale(session.tuning, 'scaleX', 'previousScaleX', Number(scaleXRecommendation[1]));
      // At either end of Scale Y's range the fixed replies send the player to REDO the slot: its pull changes.
      if (/\bREDO that slot\b/i.test(answer)) forgetPullTests(session.tuning);
      console.info(`[TCP Session] Waiting for test result: ${session.key}`);
    }
  }

  reset(guildId: string, channelId: string, userId: string): void {
    this.sessions.delete(this.key(guildId, channelId, userId));
  }
}

/**
 * The Workshop part of a question: whether the recorded pull fires, the slot, Scale Y/X (with their previous
 * values, as for Vertical), and on a pull the home screen's V and H as the pull, never as Vertical/Horizontal.
 */
function updateRecordedPull(state: TuningState, details: UserQuestionDetails, question: string): void {
  if (details.workshopSlot !== undefined) {
    if (state.workshopSlot !== undefined && state.workshopSlot !== details.workshopSlot) {
      for (const field of SLOT_FIELDS) delete state[field];
    }
    state.workshopSlot = details.workshopSlot;
  }
  if (details.recordedPull !== undefined) state.onRecordedPull = details.recordedPull;
  if (details.recordedPull === false) {
    delete state.pullVertical;
    delete state.pullHorizontal;
  }
  if (REDONE.test(question)) forgetPullTests(state);
  if (details.scaleY !== undefined) setScale(state, 'scaleY', 'previousScaleY', details.scaleY);
  if (details.scaleX !== undefined) setScale(state, 'scaleX', 'previousScaleX', details.scaleX);
  // "from 100 to 110": the player said what it was before.
  if (details.previousScaleY !== undefined) state.previousScaleY = details.previousScaleY;
  if (details.previousScaleX !== undefined) state.previousScaleX = details.previousScaleX;
  if (state.onRecordedPull) {
    if (details.screenVertical !== undefined) state.pullVertical = details.screenVertical;
    if (details.screenHorizontal !== undefined) state.pullHorizontal = details.screenHorizontal;
  }
}

function setScale(state: TuningState, field: 'scaleY' | 'scaleX', previousField: 'previousScaleY' | 'previousScaleX', value: number): void {
  const next = clampScale(value);
  const current = state[field];
  if (current !== undefined && current !== next) state[previousField] = current;
  state[field] = next;
}

function forgetPullTests(state: TuningState): void {
  for (const field of PULL_TEST_FIELDS) delete state[field];
}

/**
 * Keeps the range the balance point is in: a value that climbs raises the bottom of it, one that pulls down
 * lowers the top. A report on the wrong side of a bound (it climbs at or above a value that pulled down) means
 * something changed, so that bound is dropped.
 */
function updateScaleYTests(state: TuningState, symptom: Symptom): void {
  const value = state.scaleY;
  if (value === undefined) return;
  if (symptom === 'CLIMBING') {
    if (state.scaleYPullsDown !== undefined && state.scaleYPullsDown <= value) delete state.scaleYPullsDown;
    state.scaleYClimbs = Math.max(state.scaleYClimbs ?? value, value);
  } else if (symptom === 'PULLING_DOWN') {
    if (state.scaleYClimbs !== undefined && state.scaleYClimbs >= value) delete state.scaleYClimbs;
    state.scaleYPullsDown = Math.min(state.scaleYPullsDown ?? value, value);
  }
}

function detailSymptom(symptom: string | undefined): Symptom | undefined {
  if (symptom === 'upward_climb') return 'CLIMBING';
  if (symptom === 'left_pull') return 'DRIFTING_LEFT';
  if (symptom === 'right_pull') return 'DRIFTING_RIGHT';
  if (symptom === 'unstable_micro_aim') return 'SHAKY';
  return undefined;
}

/** The symptom a test result reports ("still climbing", "it pulls down now", "feels centred"). Not "Stable Core". */
function testResultSymptom(question: string): Symptom | undefined {
  if (/still\s+(?:going\s+)?up|climb|upward/i.test(question)) return 'CLIMBING';
  if (/pull(?:s|ing)?\s+down/i.test(question)) return 'PULLING_DOWN';
  if (/pull(?:s|ing)?\s+left/i.test(question)) return 'DRIFTING_LEFT';
  if (/pull(?:s|ing)?\s+right/i.test(question)) return 'DRIFTING_RIGHT';
  if (/shaky|unstable/i.test(question)) return 'SHAKY';
  if (/better|cent(?:er|r)ed|stable(?!\s+core)/i.test(question)) return 'STABLE';
  return undefined;
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
