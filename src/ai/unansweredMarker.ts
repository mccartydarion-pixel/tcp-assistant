// The marker the model puts on replies the documentation could not answer, and the helpers around it.
// Kept apart from unanswered.ts (which posts to Discord) so the prompt builder can use it without loading
// the bot's environment.
export const UNANSWERED_MARKER = '[[UNANSWERED]]';
export const UNANSWERED_INSTRUCTION =
  `If the T.C.P. reference material does not contain what is needed to answer, still reply helpfully (say what you are unsure of, or what you need to know), and put the marker ${UNANSWERED_MARKER} on its own line at the very end. Never use the marker when the reference material answers the question.`;

const REPEAT_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Removes the marker from a model reply and says whether it was there. */
export function extractUnansweredMarker(reply: string): { text: string; flagged: boolean } {
  const flagged = reply.includes(UNANSWERED_MARKER);
  return { text: reply.split(UNANSWERED_MARKER).join('').trim(), flagged };
}

/** The question in a form where small differences (case, punctuation, spacing) count as the same. */
export function questionKey(question: string): string {
  return question.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** True when this question should be logged now: not already logged within the last day. */
export function shouldLog(question: string, now: number, seen: Map<string, number>): boolean {
  const key = questionKey(question);
  if (!key) return false;
  const last = seen.get(key);
  if (last !== undefined && now - last < REPEAT_WINDOW_MS) return false;
  seen.set(key, now);
  return true;
}
