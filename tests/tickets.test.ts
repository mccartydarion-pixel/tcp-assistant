import { describe, expect, it } from 'vitest';
import { buildTicketSummary, classifyTicket } from '../src/tickets/ticketAssistant.js';

describe('ticket assistant', () => {
  it('classifies recoil issues', () => {
    expect(classifyTicket('my gun keeps climbing')).toBe('RECOIL');
  });

  it('builds a structured summary', () => {
    const summary = buildTicketSummary({
      issue: 'Recoil climbing',
      version: 'Stable Core 2.0',
      settings: { vertical: 36, horizontal: 13, adsSens: 90, precision: 45, response: 95, easing: 8 },
      observedBehavior: 'Weapon climbs during sustained fire.',
      troubleshooting: ['Vertical 36 -> 37', 'Still climbing'],
      confidence: 'MEDIUM',
    });

    expect(summary).toContain('T.C.P. ASSISTANT — TICKET SUMMARY');
    expect(summary).toContain('Vertical');
  });
});
