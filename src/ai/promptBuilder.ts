import type { RetrievalResult } from '../knowledge/types.js';
import type { UserQuestionDetails } from './question.js';
import { systemPrompt } from './systemPrompt.js';
import type { TuningState } from './conversationMemory.js';

export interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
}

export function buildTCPContext(results: RetrievalResult[], details: UserQuestionDetails): string {
  const references = results.length === 0
    ? 'No authoritative T.C.P. documentation was retrieved.'
    : results.map(({ chunk }) => {
        const title = `${chunk.section}${chunk.subsection ? ` > ${chunk.subsection}` : ''}`;
        return `[${title}]\n${chunk.content}`;
      }).join('\n\n');

  return `T.C.P. REFERENCE MATERIAL\n${references}\n\nEXTRACTED USER DETAILS\n${JSON.stringify(details)}`;
}

export function buildTuningContext(state: TuningState): string {
  return `TUNING SESSION\n${JSON.stringify(state)}`;
}

export function buildTCPPrompt(params: {
  question: string;
  retrievedChunks: RetrievalResult[];
  conversationHistory?: ConversationTurn[];
  details: UserQuestionDetails;
  tuningState?: TuningState;
}): { question: string; system: string; context: string; history: ConversationTurn[] } {
  return {
    question: params.question,
    system: `${systemPrompt}\n\nUse the supplied T.C.P. documentation as authoritative context. Do not simply repeat it; solve the user's actual problem. Identify symptoms and settings, give practical troubleshooting steps, and recommend one small controlled test at a time. Preserve the user's terminology and values. If the documentation is insufficient, say what information is missing and ask a useful follow-up question. Keep responses concise and conversational.`,
    context: `${buildTCPContext(params.retrievedChunks, params.details)}\n\n${buildTuningContext(params.tuningState ?? {})}`,
    history: params.conversationHistory?.slice(-8) ?? [],
  };
}
