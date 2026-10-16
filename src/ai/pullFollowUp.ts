import type { FollowUpIntent, TuningState } from './conversationMemory.js';
import { SCALE_DEFAULT, SCALE_MAX, SCALE_MIN } from './question.js';

/**
 * How far the fixed replies move Scale Y in one go: 5%, five presses of Up or Down (Scale Y moves 1 per press).
 * A recorded pull is around 20 to 35, so 5% is one or two units of pull, about what one Vertical step does.
 */
export const SCALE_Y_STEP = 5;

const SCALE_Y_ITEM = 'Workshop page (27/27, LEFT once from Master), L1/R1 to Scale Y (4/6)';

function presses(count: number, button: 'Up' | 'Down'): string {
  return count === 1 ? `press ${button} once` : `press ${button} ${count} times`;
}

function keepScaleY(scaleY: number | undefined): string {
  return `Keep Scale Y ${scaleY !== undefined ? `at ${scaleY}` : 'where it is'}; it saves when you close the menu.`;
}

/**
 * The fixed follow-up replies for a player whose Workshop slot with a recorded pull is selected. Vertical and
 * Horizontal Recoil are locked then, so these tune Scale Y (and point to Scale X) instead. Every reply that
 * changes Scale Y names the new value as "Scale Y to N" so ConversationMemory.record() can follow it.
 * Undefined when the player is not on a recorded pull, or for anything these do not cover.
 */
export function recordedPullReply(intent: FollowUpIntent, state: TuningState): string | undefined {
  if (!state.onRecordedPull) return undefined;
  const { scaleY, previousScaleY } = state;

  if (intent === 'RESOLVED') {
    return `Perfect. ${keepScaleY(scaleY)} We can tune Scale X or ADS separately if you need to.`;
  }
  if (intent !== 'TEST_RESULT') return undefined;

  // One apart and on opposite sides (one climbs, the other pulls down): there is no whole value in between.
  if (scaleY !== undefined && previousScaleY !== undefined) {
    const gap = previousScaleY - scaleY;
    if ((state.currentSymptom === 'CLIMBING' && gap === 1) || (state.currentSymptom === 'PULLING_DOWN' && gap === -1)) {
      return `The balance point is between Scale Y ${Math.min(scaleY, previousScaleY)} and ${Math.max(scaleY, previousScaleY)}. Keep whichever feels better; it saves when you close the menu.`;
    }
  }

  if (state.currentSymptom === 'CLIMBING') {
    if (scaleY === undefined) {
      return `Vertical Recoil is locked while a recorded pull is selected, so raise Scale Y instead: ${SCALE_Y_ITEM}, then ${presses(SCALE_Y_STEP, 'Up')} (+${SCALE_Y_STEP}%; it starts at ${SCALE_DEFAULT}). Keep Scale X unchanged so we are testing one variable.`;
    }
    if (scaleY >= SCALE_MAX) {
      return `Scale Y is already at its ${SCALE_MAX} maximum. REDO that slot (Record, 3/6 on the Workshop page) so the recorded pull itself is stronger.`;
    }
    if (previousScaleY !== undefined && previousScaleY > scaleY) {
      // Came down from a value that pulled down: the balance point is between the two.
      const target = Math.ceil((scaleY + previousScaleY) / 2);
      return `Since Scale Y ${scaleY} is still climbing, raise Scale Y to ${target}, back toward ${previousScaleY} (${presses(target - scaleY, 'Up')}), and retest.`;
    }
    const target = Math.min(SCALE_MAX, scaleY + SCALE_Y_STEP);
    return `Since Scale Y ${scaleY} is still climbing, raise Scale Y to ${target} next (${presses(target - scaleY, 'Up')}). Keep Scale X unchanged so we are testing one variable.`;
  }

  if (state.currentSymptom === 'PULLING_DOWN') {
    if (scaleY === undefined) {
      return `Vertical Recoil is locked while a recorded pull is selected, so lower Scale Y instead: ${SCALE_Y_ITEM}, then ${presses(SCALE_Y_STEP, 'Down')} (-${SCALE_Y_STEP}%; it starts at ${SCALE_DEFAULT}). Keep Scale X unchanged so we are testing one variable.`;
    }
    if (previousScaleY !== undefined && previousScaleY < scaleY) {
      const target = Math.floor((scaleY + previousScaleY) / 2);
      return `You have crossed the balance point. Move Scale Y back toward ${previousScaleY}: set Scale Y to ${target} (${presses(scaleY - target, 'Down')}) and retest.`;
    }
    if (scaleY <= SCALE_MIN) {
      return `Scale Y is already at its ${SCALE_MIN} minimum. REDO that slot (Record, 3/6 on the Workshop page) and hold the mark steady while you record.`;
    }
    const target = Math.max(SCALE_MIN, scaleY - SCALE_Y_STEP);
    return `Since Scale Y ${scaleY} pulls down, lower Scale Y to ${target} next (${presses(scaleY - target, 'Down')}) and retest.`;
  }

  if (state.currentSymptom === 'STABLE') {
    return `Perfect. ${keepScaleY(scaleY)}`;
  }
  return undefined;
}
