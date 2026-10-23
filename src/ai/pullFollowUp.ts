import type { FollowUpIntent, TuningState } from './conversationMemory.js';
import { SCALE_DEFAULT, SCALE_MAX, SCALE_MIN, type UserQuestionDetails } from './question.js';

/**
 * How far the fixed replies move Scale Y in one go: 5%, five presses of Up or Down (Scale Y moves 1 per press).
 * A recorded pull is around 20 to 35, so 5% is one or two units of pull, about what one Vertical step does.
 */
export const SCALE_Y_STEP = 5;

/** How far back an unknown Scale Y goes once it has crossed the balance point: half a step, rounded up. */
const SCALE_Y_BACK = Math.ceil(SCALE_Y_STEP / 2);

const SCALE_Y_ITEM = 'Workshop page (26/26, LEFT once from Master), L1/R1 to Scale Y (5/7)';
const ASK_VALUE = 'tell me the Scale Y number it shows';

/**
 * How the replies that move Scale Y without knowing its value begin, as record() keeps them in lastRecommendation
 * (from the first "raise" or "lower"). "by another 5" is a full step, "by 3" or "by 1" a step after crossing.
 */
const UNKNOWN_STEP = /^(raise|lower) Scale Y (?:instead\b|by\s+(another\s+)?(\d+))/i;

/** A recording stores the measured pull divided by the current Scale Y, so Scale Y goes back to 100 before a REDO. */
const REDO_AT_100 = `Move Scale Y to ${SCALE_DEFAULT} first, then REDO that slot (Record, 4/7 on the Workshop page)`;

type Direction = 'raise' | 'lower';

function presses(count: number, button: 'Up' | 'Down'): string {
  return count === 1 ? `press ${button} once` : `press ${button} ${count} times`;
}

function keepScaleY(scaleY: number | undefined): string {
  return `Keep Scale Y ${scaleY !== undefined ? `at ${scaleY}` : 'where it is'}; it saves when you close the menu.`;
}

function between(low: number, high: number): string {
  return `The balance point is between Scale Y ${low} and ${high}. Keep whichever feels better; it saves when you close the menu.`;
}

/**
 * The player gave a Vertical or Horizontal value in this message and said nothing about the pull. They may have
 * gone back to Vertical (Weapon OFF, or a gun on an empty slot), so the replies ask before they change Scale Y.
 */
function unsureOfPull(details: UserQuestionDetails | undefined): boolean {
  return details !== undefined && details.recordedPull === undefined && (details.vertical !== undefined || details.horizontal !== undefined);
}

/**
 * Scale Y climbs at value: raise it. Bisects between the highest value that climbed (scaleYClimbs) and the lowest
 * that pulled down (scaleYPullsDown); without those, a higher previous value is taken as the one that pulled down.
 */
function climbing(value: number, state: TuningState): string {
  const low = Math.max(state.scaleYClimbs ?? value, value);
  const previous = state.previousScaleY;
  const high = state.scaleYPullsDown ?? (previous !== undefined && previous > value ? previous : undefined);
  if (high !== undefined && high > low) {
    if (high - low <= 1) return between(low, high);
    const target = Math.ceil((low + high) / 2);
    return `Since Scale Y ${value} is still climbing, raise Scale Y to ${target}, back toward ${high} (${presses(target - value, 'Up')}), and retest.`;
  }
  if (low >= SCALE_MAX) {
    return `Scale Y is already at its ${SCALE_MAX} maximum. ${REDO_AT_100}, so the new recording has room to go either way.`;
  }
  const target = Math.min(SCALE_MAX, low + SCALE_Y_STEP);
  return `Since Scale Y ${value} is still climbing, raise Scale Y to ${target} next (${presses(target - value, 'Up')}). Keep Scale X unchanged so we are testing one variable.`;
}

/** Scale Y pulls down at value: lower it, the mirror of climbing(). */
function pullingDown(value: number, state: TuningState): string {
  const high = Math.min(state.scaleYPullsDown ?? value, value);
  const previous = state.previousScaleY;
  const low = state.scaleYClimbs ?? (previous !== undefined && previous < value ? previous : undefined);
  if (low !== undefined && low < high) {
    if (high - low <= 1) return between(low, high);
    const target = Math.floor((low + high) / 2);
    return `You have crossed the balance point. Move Scale Y back toward ${low}: set Scale Y to ${target} (${presses(value - target, 'Down')}) and retest.`;
  }
  if (high <= SCALE_MIN) {
    return `Scale Y is already at its ${SCALE_MIN} minimum. ${REDO_AT_100} and hold the mark steady while you record, so the new recording has room to go either way.`;
  }
  const target = Math.max(SCALE_MIN, high - SCALE_Y_STEP);
  return `Since Scale Y ${value} pulls down, lower Scale Y to ${target} next (${presses(value - target, 'Down')}) and retest.`;
}

/**
 * Scale Y's value is not known. The first reply says Vertical is locked and where Scale Y is; the next ones are
 * short. Each asks for the number, so the stepped replies above can take over once the player gives it.
 */
function unknownValue(direction: Direction, state: TuningState): string {
  const button = direction === 'raise' ? 'Up' : 'Down';
  const verb = direction === 'raise' ? 'Raise' : 'Lower';
  const last = state.lastRecommendation?.match(UNKNOWN_STEP);
  if (!last) {
    const sign = direction === 'raise' ? '+' : '-';
    return `Vertical Recoil is locked while a recorded pull is selected, so ${direction} Scale Y instead: ${SCALE_Y_ITEM}, then ${presses(SCALE_Y_STEP, button)} (${sign}${SCALE_Y_STEP}%; it starts at ${SCALE_DEFAULT}). Keep Scale X unchanged, and ${ASK_VALUE}.`;
  }
  const lastDirection = last[1]?.toLowerCase() as Direction;
  const fullStep = last[3] === undefined || last[2] !== undefined;
  if (!fullStep) return `${verb} Scale Y by 1 (${presses(1, button)}), then ${ASK_VALUE}.`;
  if (lastDirection === direction) return `${verb} Scale Y by another ${SCALE_Y_STEP} (${presses(SCALE_Y_STEP, button)}), then ${ASK_VALUE}.`;
  return `You have crossed the balance point. ${verb} Scale Y by ${SCALE_Y_BACK} (${presses(SCALE_Y_BACK, button)}), then ${ASK_VALUE}.`;
}

/**
 * The fixed follow-up replies for a player whose Workshop slot with a recorded pull is selected. Vertical and
 * Horizontal Recoil are locked then, so these tune Scale Y (and point to Scale X) instead. Every reply that sets
 * a new Scale Y names it as "Scale Y to N" so ConversationMemory.record() can follow it; the ones that move it by
 * presses alone never put a number straight after "Scale Y". `details` is what the current message said.
 * Undefined when the player is not on a recorded pull, or for anything these do not cover.
 */
export function recordedPullReply(intent: FollowUpIntent, state: TuningState, details?: UserQuestionDetails): string | undefined {
  if (!state.onRecordedPull) return undefined;
  const { scaleY, currentSymptom } = state;

  if (intent === 'RESOLVED') {
    // Only talk about Scale Y when it was what we were tuning.
    const tunedScaleY = scaleY !== undefined || currentSymptom === 'CLIMBING' || currentSymptom === 'PULLING_DOWN' || currentSymptom === 'STABLE';
    return tunedScaleY
      ? `Perfect. ${keepScaleY(scaleY)} We can tune Scale X or ADS separately if you need to.`
      : 'Perfect. It saves when you close the menu. We can tune Scale X or ADS separately if you need to.';
  }
  if (intent !== 'TEST_RESULT') return undefined;
  if (currentSymptom !== 'CLIMBING' && currentSymptom !== 'PULLING_DOWN' && currentSymptom !== 'STABLE') return undefined;

  if (unsureOfPull(details)) {
    if (currentSymptom === 'STABLE') return 'Perfect. Keep what you have; it saves when you close the menu.';
    return 'Before we change anything: does the home screen show PULL or STD for this gun? On PULL, Vertical and Horizontal Recoil are locked and the gun is tuned with Scale Y on the Workshop page (26/26); on STD or with Weapon OFF, your Vertical and Horizontal Recoil fire as set.';
  }
  if (currentSymptom === 'STABLE') return `Perfect. ${keepScaleY(scaleY)}`;
  if (scaleY === undefined) return unknownValue(currentSymptom === 'CLIMBING' ? 'raise' : 'lower', state);
  return currentSymptom === 'CLIMBING' ? climbing(scaleY, state) : pullingDown(scaleY, state);
}
