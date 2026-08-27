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
      return 'ADS feels sluggish. Review ADS Sens, Precision, Response, and Easing and make a small single-variable adjustment.';
    case 'TOO_FAST':
      return 'ADS feels too fast. Reduce ADS Sens or Response slightly, then retest.';
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
    precision: 45,
    response: 95,
    easing: 8,
  };
}
