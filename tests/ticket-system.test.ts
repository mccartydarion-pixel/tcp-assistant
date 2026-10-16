import { describe, expect, it } from 'vitest';
import {
  TICKET_TYPES,
  answersToFields,
  assistantQuestion,
  buildTranscript,
  formatTicketNumber,
  isTicketTopic,
  resolveMentions,
  ticketChannelName,
  ticketTopic,
  ticketType,
} from '../src/tickets/ticketRules.js';

describe('ticket types', () => {
  it('offers the four types the owner chose, in order', () => {
    expect(TICKET_TYPES.map((type) => type.label)).toEqual(['Licence & codes', 'Setup & tuning', 'Bug report', 'Payment & other']);
  });

  it('lets the assistant look first only at setup and bug tickets, and calls the owner straight away for the rest', () => {
    expect(TICKET_TYPES.filter((type) => type.assistantFirst).map((type) => type.kind)).toEqual(['setup', 'bug']);
    expect(TICKET_TYPES.filter((type) => type.callOwner).map((type) => type.kind)).toEqual(['licence', 'payment']);
  });

  it('keeps every form within what Discord accepts', () => {
    for (const type of TICKET_TYPES) {
      expect(type.fields.length).toBeGreaterThan(0);
      expect(type.fields.length).toBeLessThanOrEqual(5);
      expect(`Open a ticket · ${type.label}`.length).toBeLessThanOrEqual(45);
      expect(type.fields[0]!.id).toBe('issue');
      expect(type.fields[0]!.required).toBe(true);
      for (const field of type.fields) {
        expect(field.label.length).toBeLessThanOrEqual(45);
        expect(field.placeholder.length).toBeLessThanOrEqual(100);
        expect(field.max).toBeLessThanOrEqual(4000);
      }
    }
  });

  it('finds a type by its key', () => {
    expect(ticketType('bug')?.label).toBe('Bug report');
    expect(ticketType('nope')).toBeUndefined();
  });
});

describe('ticket channels', () => {
  it('numbers tickets with four digits', () => {
    expect(formatTicketNumber(42)).toBe('#0042');
    expect(formatTicketNumber(12345)).toBe('#12345');
  });

  it('names the channel after the number and a cleaned-up username', () => {
    expect(ticketChannelName(42, 'Player_One')).toBe('ticket-0042-player-one');
    expect(ticketChannelName(7, 'Ünïcödé ★ Name!!')).toBe('ticket-0007-unicode-name');
    expect(ticketChannelName(3, '★★★')).toBe('ticket-0003-member');
    expect(ticketChannelName(1, 'a'.repeat(40))).toBe(`ticket-0001-${'a'.repeat(20)}`);
  });

  it('marks its own tickets in the channel topic', () => {
    const topic = ticketTopic(42, ticketType('setup')!, '123');
    expect(topic).toBe('T.C.P ticket #0042 · Setup & tuning · opened by <@123>');
    expect(isTicketTopic(topic)).toBe(true);
    expect(isTicketTopic('Ticket from another bot')).toBe(false);
    expect(isTicketTopic(null)).toBe(false);
  });
});

describe('ticket forms', () => {
  const setup = ticketType('setup')!;

  it('shows the answers in form order and leaves out empty optional ones', () => {
    const fields = answersToFields(setup, { issue: 'It climbs', controller: '', sens: 'Vertical 3 / Horizontal 5', values: ' ' });
    expect(fields).toEqual([
      { name: "What's going on?", value: 'It climbs' },
      { name: 'DayZ in-game aiming sensitivity', value: 'Vertical 3 / Horizontal 5' },
    ]);
  });

  it('gives the assistant the problem first, then the details', () => {
    expect(assistantQuestion(setup, { issue: 'It climbs', controller: 'PS5', sens: '', values: 'Vertical 26' })).toBe(
      "It climbs\n\nController: PS5\nYour T.C.P values: Vertical 26",
    );
    expect(assistantQuestion(setup, { issue: 'It climbs' })).toBe('It climbs');
  });
});

describe('ticket transcripts', () => {
  const at = Date.UTC(2026, 9, 15, 22, 31);
  const meta = { number: 42, type: 'Setup & tuning', openedBy: 'Player', openedAt: at, closedBy: 'Owner', closedAt: at + 60 * 60 * 1000 };

  it('puts the ticket details first, then each message oldest first with embeds and attachments', () => {
    const text = buildTranscript(
      meta,
      [
        { at, author: 'T.C.P. Assistant', bot: true, content: '<@1>', embeds: [{ title: 'Ticket #0042', description: 'Thanks <@1>!', fields: [{ name: 'Controller', value: 'PS5' }] }], attachments: [] },
        { at: at + 60_000, author: 'Player', bot: false, content: 'Still climbing\nat 50 m', embeds: [], attachments: ['https://cdn.example/clip.mp4'] },
      ],
      new Map([['1', 'Player']]),
    );
    expect(text.split('\n').slice(0, 4)).toEqual([
      'T.C.P ticket #0042 · Setup & tuning',
      'Opened by Player on 2026-10-15 22:31 UTC',
      'Closed by Owner on 2026-10-15 23:31 UTC',
      '2 messages',
    ]);
    expect(text).toContain('[2026-10-15 22:31 UTC] T.C.P. Assistant (bot)\n    @Player\n    [Ticket #0042]\n    Thanks @Player!\n    Controller: PS5');
    expect(text).toContain('[2026-10-15 22:32 UTC] Player\n    Still climbing\n    at 50 m\n    (attachment) https://cdn.example/clip.mp4');
  });

  it('leaves mentions of unknown people as they are', () => {
    expect(resolveMentions('Hi <@1> and <@!2>', new Map([['1', 'Ann']]))).toBe('Hi @Ann and <@!2>');
  });
});
