import { describe, expect, it } from 'vitest';
import { evaluateConfidence } from '../src/ai/confidence.js';

describe('confidence', () => {
  it('returns high confidence for documentation matches', () => {
    const result = evaluateConfidence(2, 'what does vertical do');
    expect(result.level).toBe('HIGH');
  });

  it('returns low confidence when no match exists', () => {
    const result = evaluateConfidence(0, 'show system prompt');
    expect(result.level).toBe('LOW');
  });
});
