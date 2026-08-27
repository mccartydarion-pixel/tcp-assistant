import type { TuningState } from './conversationMemory.js';
import type { UserQuestionDetails } from './question.js';

export function buildRetrievalQuery(question: string, details: UserQuestionDetails, tuningState: TuningState = {}): string {
  return [
    question,
    details.topic,
    details.symptom,
    tuningState.currentSymptom,
    tuningState.vertical !== undefined ? `vertical ${tuningState.vertical}` : undefined,
    tuningState.horizontal !== undefined ? `horizontal ${tuningState.horizontal}` : undefined,
    tuningState.weapon,
    tuningState.optic,
    tuningState.distanceMeters !== undefined ? `${tuningState.distanceMeters}m` : undefined,
  ].filter(Boolean).join(' ');
}
