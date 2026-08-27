import type { ConfidenceLevel, ConfidenceResult } from '../knowledge/types.js';

export function evaluateConfidence(matchCount: number, question: string): ConfidenceResult {
  const normalized = question.toLowerCase();

  if (matchCount >= 1 && !/(guarantee|unknown|does not exist|secret|api key|system prompt)/i.test(normalized)) {
    return {
      level: 'HIGH',
      score: 90,
      reason: 'Strong documentation match',
    };
  }

  if (matchCount > 0) {
    return {
      level: 'MEDIUM',
      score: 60,
      reason: 'Documentation supports the concept, but hardware behavior may vary',
    };
  }

  return {
    level: 'LOW',
    score: 20,
    reason: 'No reliable documentation match or unresolved hardware issue',
  };
}

export function isHighConfidence(level: ConfidenceLevel): boolean {
  return level === 'HIGH';
}
