import { describe, expect, it } from 'vitest';
import { IDLE_MS, SOLVED_GRACE_MS, SOLVED_NOTICE, helpTranscript, looseMessageIsDone, threadIsDone, wasSolved } from '../src/help/helpCleanupRules.js';
import type { TranscriptMessage } from '../src/tickets/ticketRules.js';

const now = 1_800_000_000_000;
const MINUTE = 60 * 1000;

describe('help threads', () => {
  it('goes a few minutes after Solved, not straight away', () => {
    expect(threadIsDone({ archived: true, archivedAt: now - MINUTE, lastActivityAt: now - MINUTE }, now)).toBe(false);
    expect(threadIsDone({ archived: true, archivedAt: now - SOLVED_GRACE_MS, lastActivityAt: now - SOLVED_GRACE_MS }, now)).toBe(true);
  });

  it('goes once Discord archived it for a day without messages', () => {
    expect(threadIsDone({ archived: true, archivedAt: now - 10 * MINUTE, lastActivityAt: now - IDLE_MS - 10 * MINUTE }, now)).toBe(true);
  });

  it('stays while the conversation is going, and goes after a quiet day even if not archived', () => {
    expect(threadIsDone({ archived: false, archivedAt: null, lastActivityAt: now - 3 * 60 * MINUTE }, now)).toBe(false);
    expect(threadIsDone({ archived: false, archivedAt: null, lastActivityAt: now - IDLE_MS }, now)).toBe(true);
  });

  it('knows a thread was solved from the notice the bot posted', () => {
    const answer: TranscriptMessage = { at: now, author: 'T.C.P', bot: true, content: '', embeds: [{ description: 'Go to the licence channel.' }], attachments: [] };
    const solved: TranscriptMessage = { ...answer, embeds: [{ description: SOLVED_NOTICE }] };
    const memberSaysIt: TranscriptMessage = { ...answer, bot: false, embeds: [{ description: 'Marked as solved' }] };
    expect(wasSolved([answer])).toBe(false);
    expect(wasSolved([answer, memberSaysIt])).toBe(false);
    expect(wasSolved([answer, solved])).toBe(true);
    expect(SOLVED_NOTICE).toContain('cleared away in 5 minutes');
  });
});

describe('loose messages in the help channel', () => {
  const old = { at: now - IDLE_MS, pinned: false, fromOwner: false, isPanel: false, hasThread: false };

  it('go after a day', () => {
    expect(looseMessageIsDone(old, now)).toBe(true);
    expect(looseMessageIsDone({ ...old, at: now - IDLE_MS + MINUTE }, now)).toBe(false);
  });

  it('never the panel, pinned messages, the owner, or a question whose thread is still open', () => {
    expect(looseMessageIsDone({ ...old, isPanel: true }, now)).toBe(false);
    expect(looseMessageIsDone({ ...old, pinned: true }, now)).toBe(false);
    expect(looseMessageIsDone({ ...old, fromOwner: true }, now)).toBe(false);
    expect(looseMessageIsDone({ ...old, hasThread: true }, now)).toBe(false);
  });
});

describe('help transcript', () => {
  it('starts with the question and leaves out the empty thread placeholder', () => {
    const messages: TranscriptMessage[] = [
      { at: now + 1, author: 'Vaya', bot: false, content: '', embeds: [], attachments: [] },
      { at: now + 2, author: 'T.C.P', bot: true, content: '', embeds: [{ description: 'Here is how to get the script.' }], attachments: [] },
      { at: now + 3, author: 'T.C.P', bot: true, content: '', embeds: [{ description: SOLVED_NOTICE }], attachments: [] },
    ];
    const text = helpTranscript(
      { threadName: 'i need help downloading the tcp script', askedBy: 'Vaya', startedAt: now, question: 'i need help downloading the tcp script', outcome: 'Solved', closedAt: now + 6 * MINUTE },
      messages,
    );
    expect(text.split('\n')[0]).toBe('T.C.P help thread · i need help downloading the tcp script');
    expect(text).toContain('Asked by Vaya on');
    expect(text).toContain('Solved; cleared away on');
    expect(text).toContain('3 messages');
    expect(text.indexOf('i need help downloading the tcp script', 60)).toBeLessThan(text.indexOf('Here is how to get the script.'));
  });
});
