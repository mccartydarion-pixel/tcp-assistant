import { describe, expect, it, vi } from 'vitest';
import { detectEscalationIntent, EscalationService } from '../src/ai/escalation.js';

describe('human escalation', () => {
  it.each(['can you get the owner in here', 'ping the owner', 'I need a human', 'get an admin', 'AI is not helping, escalate this'])('detects %s', (question) => {
    expect(detectEscalationIntent(question)).not.toBeNull();
  });

  it.each(['who is the owner?', 'what does the owner do?', 'is the owner online?', 'can the owner change recoil settings?'])('does not escalate informational question: %s', (question) => {
    expect(detectEscalationIntent(question)).toBeNull();
  });

  it('notifies once per guild, channel, and user during cooldown', () => {
    const service = new EscalationService(600_000);
    expect(service.request('guild', 'channel', 'user', 'get the owner')?.shouldNotify).toBe(true);
    expect(service.request('guild', 'channel', 'user', 'get the owner')?.shouldNotify).toBe(false);
    expect(service.isEscalated('guild', 'channel')).toBe(true);
  });

  it('lets the owner take over an escalated conversation', () => {
    const service = new EscalationService();
    service.request('guild', 'channel', 'user', 'I need a human');
    expect(service.isOwnerHandling('guild', 'channel')).toBe(false);
    service.markOwnerJoined('guild', 'channel');
    expect(service.isOwnerHandling('guild', 'channel')).toBe(true);
  });
});
