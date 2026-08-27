import { describe, expect, it } from 'vitest';
import { determineMessageRoute } from '../src/bot/messageRoute.js';

describe('message route priority', () => {
  it.each([
    [{ isTicket: false, mentionsBot: false }, 'IGNORE'],
    [{ isTicket: false, mentionsBot: true }, 'MENTION'],
    [{ isTicket: true, mentionsBot: false }, 'TICKET'],
    [{ isTicket: true, mentionsBot: true }, 'TICKET_MENTION'],
  ] as const)('maps %j to %s', (input, expected) => {
    expect(determineMessageRoute(input)).toBe(expected);
  });
});
