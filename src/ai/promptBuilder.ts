import type { RetrievalResult } from '../knowledge/types.js';
import type { UserQuestionDetails } from './question.js';
import { systemPrompt } from './systemPrompt.js';
import { UNANSWERED_INSTRUCTION } from './unansweredMarker.js';
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

/** How the assistant may use the server map: link only channels from it, never invent or guess one. */
export const SERVER_MAP_INSTRUCTION =
  'SERVER CHANNELS lists the Discord channels this member can see. When pointing someone to a place in the server (downloads, licence codes, settings, rules, help, tickets), link the channel by writing its <#id> exactly as listed. Never mention or guess a channel that is not listed there.';

export function buildTCPPrompt(params: {
  question: string;
  retrievedChunks: RetrievalResult[];
  conversationHistory?: ConversationTurn[];
  details: UserQuestionDetails;
  tuningState?: TuningState;
  /** The server's channels the member can see, from describeServerForAssistant. */
  serverMap?: string;
}): { question: string; system: string; context: string; history: ConversationTurn[] } {
  const serverRules = params.serverMap ? `\n\n${SERVER_MAP_INSTRUCTION}` : '';
  const serverContext = params.serverMap ? `\n\n${params.serverMap}` : '';
  return {
    question: params.question,
    system: `${systemPrompt}\n\nUse the supplied T.C.P. documentation as authoritative context. Do not simply repeat it; solve the user's actual problem. Identify symptoms and settings, give practical troubleshooting steps, and recommend one small controlled test at a time. Preserve the user's terminology and values. If the documentation is insufficient, say what information is missing and ask a useful follow-up question. Keep responses concise and conversational.${serverRules}\n\n${UNANSWERED_INSTRUCTION}`,
    context: `${buildTCPContext(params.retrievedChunks, params.details)}\n\n${buildTuningContext(params.tuningState ?? {})}${serverContext}`,
    history: params.conversationHistory?.slice(-8) ?? [],
  };
}
