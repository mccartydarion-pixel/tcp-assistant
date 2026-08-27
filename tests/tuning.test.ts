import { describe, expect, it } from 'vitest';
import { TuningService } from '../src/tuning/tuningService.js';

describe('tuning service', () => {
  it('recommends a small vertical increase for climbing', () => {
    const service = new TuningService();
    const recommendation = service.recommend('user-1', 'CLIMBING');
    expect(recommendation.toLowerCase()).toContain('vertical');
    expect(recommendation.toLowerCase()).toContain('1 point');
  });

  it('recommends a small vertical decrease for pulling down', () => {
    const service = new TuningService();
    const recommendation = service.recommend('user-2', 'PULLING_DOWN');
    expect(recommendation.toLowerCase()).toContain('reduce vertical');
  });
});
