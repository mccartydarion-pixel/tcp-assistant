import { describe, expect, it } from 'vitest';
import { ConversationMemory, detectFollowUpIntent } from '../src/ai/conversationMemory.js';
import { buildRetrievalQuery } from '../src/ai/retrievalQuery.js';

 describe('conversation memory', () => {
  it('isolates sessions by guild, channel, and user', () => {
    const memory = new ConversationMemory();
    const first = memory.getOrCreate('guild', 'channel', 'user-a');
    first.tuning.vertical = 39;
    expect(memory.get('guild', 'channel', 'user-a')?.tuning.vertical).toBe(39);
    expect(memory.get('guild', 'channel', 'user-b')).toBeUndefined();
  });

  it('stores tuning values, symptoms, and recent turns', () => {
    const memory = new ConversationMemory();
    const session = memory.getOrCreate('guild', 'channel', 'user');
    memory.updateFromQuestion(session, { vertical: 38, symptom: 'upward_climb' }, 'my vertical is 38 and it keeps climbing');
    memory.record(session, 'my vertical is 38 and it keeps climbing', 'Try Vertical 39 and test again.');
    expect(session.tuning).toMatchObject({ vertical: 39, previousVertical: 38, currentSymptom: 'CLIMBING', waitingForTestResult: true });
    expect(session.turns).toHaveLength(2);
  });

  it('recognizes testing, results, and resolved follow-ups', () => {
    expect(detectFollowUpIntent('ill test it out')).toBe('TESTING');
    expect(detectFollowUpIntent('still climbing')).toBe('TEST_RESULT');
    expect(detectFollowUpIntent('perfect now')).toBe('RESOLVED');
  });

  it('enriches vague retrieval with active tuning state', () => {
    const query = buildRetrievalQuery('still climbing', { symptom: 'upward_climb' }, { vertical: 39, weapon: 'M4', distanceMeters: 150 });
    expect(query).toContain('still climbing');
    expect(query).toContain('vertical 39');
    expect(query).toContain('M4');
    expect(query).toContain('150m');
  });
});
