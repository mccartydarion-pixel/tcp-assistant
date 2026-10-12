import { describe, expect, it } from 'vitest';
import { determineMessageRoute, shouldAnswerOwner } from '../src/bot/messageRoute.js';

describe('answering the owner', () => {
  it.each([
    ['MENTION', true],
    ['CONTINUATION', true],
    ['TICKET_MENTION', true],
    ['TICKET', false],
    ['IGNORE', false],
  ] as const)('route %s answers the owner: %s', (route, expected) => {
    expect(shouldAnswerOwner(route)).toBe(expected);
  });
});

describe('message route priority', () => {
  it.each([
    [{ isTicket: false, mentionsBot: false }, 'IGNORE'],
    [{ isTicket: false, mentionsBot: true }, 'MENTION'],
    [{ isTicket: true, mentionsBot: false }, 'TICKET'],
    [{ isTicket: true, mentionsBot: true }, 'TICKET_MENTION'],
    [{ isTicket: false, mentionsBot: false, activeSession: true }, 'CONTINUATION'],
  ] as const)('maps %j to %s', (input, expected) => {
    expect(determineMessageRoute(input)).toBe(expected);
  });
});
