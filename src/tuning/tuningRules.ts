import type { TuningObservation, TuningProfile } from '../knowledge/types.js';

export function getTuningRecommendation(observation: TuningObservation, profile: TuningProfile): string {
  switch (observation) {
    case 'CLIMBING':
      return 'Your Vertical correction is probably slightly low. Increase Vertical by 1 point and retest.';
    case 'PULLING_DOWN':
      return 'Your Vertical correction is likely too strong. Reduce Vertical by 1 point and retest.';
    case 'DRIFTING_LEFT':
      return 'Adjust Horizontal slightly toward the correcting direction and retest with a small change.';
    case 'DRIFTING_RIGHT':
      return 'Adjust Horizontal slightly toward the opposite correcting direction and retest with a small change.';
    case 'BOUNCING':
      return 'Do not change multiple settings at once. Start with an AR-only baseline test and keep adjustments small.';
    case 'SLUGGISH':
      return 'ADS feels slow or laggy. If Easing is above 0, lower it first, because Easing adds delay. Otherwise raise ADS Sens slightly, then retest.';
    case 'TOO_FAST':
      return 'ADS feels too fast. Reduce ADS Sens slightly, or add a little Precision (20 to 40) for finer control near the centre, then retest.';
    case 'STABLE':
      return 'The current baseline looks stable. Keep the current values and test another weapon or range.';
    default:
      return 'Keep changes small and isolate one variable at a time.';
  }
}

export function createInitialProfile(): TuningProfile {
  return {
    vertical: 25,
    horizontal: 3,
    adsSens: 90,
    precision: 0,
    response: 100,
    easing: 0,
  };
}
