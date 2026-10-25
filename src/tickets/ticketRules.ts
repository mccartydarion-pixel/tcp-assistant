import type { APIEmbedField } from 'discord.js';

// What a T.C.P support ticket is: its four types, the form each one asks, how its channel is named, and
// how its transcript reads. Everything here is plain data and functions; ticketSystem.ts does the Discord side.

export type TicketKind = 'licence' | 'setup' | 'bug' | 'payment';

export interface TicketField {
  id: string;
  /** Discord allows 45 characters. */
  label: string;
  style: 'short' | 'paragraph';
  required: boolean;
  max: number;
  /** Discord allows 100 characters. */
  placeholder: string;
}

export interface TicketType {
  kind: TicketKind;
  label: string;
  /** One line on the ticket panel. */
  blurb: string;
  /** The assistant takes a first look before the owner. */
  assistantFirst: boolean;
  /** The owner is pinged as soon as the ticket opens. */
  callOwner: boolean;
  fields: TicketField[];
}

export const TICKET_TYPES: TicketType[] = [
  {
    kind: 'licence',
    label: 'License & codes',
    blurb: 'Unlock codes, your subscription, days left.',
    assistantFirst: false,
    callOwner: true,
    fields: [
      { id: 'issue', label: 'What do you need help with?', style: 'paragraph', required: true, max: 1000, placeholder: 'My code says WRONG CODE, I need more days...' },
      { id: 'number', label: 'The 5-digit number on your Zen (if any)', style: 'short', required: false, max: 7, placeholder: '48213' },
    ],
  },
  {
    kind: 'setup',
    label: 'Setup & tuning',
    blurb: 'Installing the script, the menu, recoil and ADS.',
    assistantFirst: true,
    callOwner: false,
    fields: [
      { id: 'issue', label: "What's going on?", style: 'paragraph', required: true, max: 1000, placeholder: 'My M4 still climbs when I spray at 50 m...' },
      { id: 'controller', label: 'Controller', style: 'short', required: false, max: 40, placeholder: 'PlayStation or Xbox' },
      { id: 'sens', label: 'DayZ in-game aiming sensitivity', style: 'short', required: false, max: 60, placeholder: 'Vertical 3 / Horizontal 5' },
      { id: 'values', label: 'Your T.C.P values', style: 'paragraph', required: false, max: 300, placeholder: 'Vertical 26, Horizontal 0, ADS Sens 60...' },
    ],
  },
  {
    kind: 'bug',
    label: 'Bug report',
    blurb: 'Something in the script is broken.',
    assistantFirst: true,
    callOwner: false,
    fields: [
      { id: 'issue', label: 'What happened?', style: 'paragraph', required: true, max: 1000, placeholder: 'Recoil stops working after the first burst...' },
      { id: 'steps', label: 'How can we make it happen?', style: 'paragraph', required: false, max: 1000, placeholder: '1. Turn on...\n2. Aim and fire...' },
      { id: 'build', label: 'Which build and version?', style: 'short', required: false, max: 100, placeholder: 'Licensed v2.0 / Free' },
    ],
  },
  {
    kind: 'payment',
    label: 'Payment & other',
    blurb: 'Purchases, refunds and anything else.',
    assistantFirst: false,
    callOwner: true,
    fields: [{ id: 'issue', label: 'How can we help?', style: 'paragraph', required: true, max: 1000, placeholder: 'Tell us what you need' }],
  },
];

export function ticketType(kind: string): TicketType | undefined {
  return TICKET_TYPES.find((type) => type.kind === kind);
}

export function formatTicketNumber(number: number): string {
  return `#${String(number).padStart(4, '0')}`;
}

/** The ticket's channel name, for example ticket-0042-player. */
export function ticketChannelName(number: number, username: string): string {
  const slug = username
    .normalize('NFKD')
    // Accented letters split into a letter and its accent mark; keep the letter.
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 20)
    .replace(/-+$/g, '');
  return `ticket-${String(number).padStart(4, '0')}-${slug || 'member'}`;
}

export const TICKET_TOPIC_PREFIX = 'T.C.P ticket #';

/** The channel topic. Its prefix also tells the bot a channel is one of its own tickets. */
export function ticketTopic(number: number, type: TicketType, userId: string): string {
  return `T.C.P ticket ${formatTicketNumber(number)} · ${type.label} · opened by <@${userId}>`;
}

export function isTicketTopic(topic: string | null | undefined): boolean {
  return Boolean(topic?.startsWith(TICKET_TOPIC_PREFIX));
}

/** The member's form answers as embed fields, in the form's order; empty optional answers are left out. */
export function answersToFields(type: TicketType, answers: Record<string, string>): APIEmbedField[] {
  return type.fields
    .map((field) => ({ name: field.label, value: (answers[field.id] ?? '').trim() }))
    .filter((field) => field.value.length > 0)
    .map((field) => ({ name: field.name, value: field.value.slice(0, 1024) }));
}

/** What the assistant is asked for its first look: the problem, then any details the member gave. */
export function assistantQuestion(type: TicketType, answers: Record<string, string>): string {
  const details = type.fields
    .filter((field) => field.id !== 'issue' && (answers[field.id] ?? '').trim())
    .map((field) => `${field.label}: ${answers[field.id]!.trim()}`);
  return [(answers.issue ?? '').trim(), ...(details.length > 0 ? ['', ...details] : [])].join('\n');
}

// ---- transcripts -------------------------------------------------------------------------------

export interface TranscriptEmbed {
  title?: string | null;
  description?: string | null;
  fields?: { name: string; value: string }[];
}

export interface TranscriptMessage {
  at: number;
  author: string;
  bot: boolean;
  content: string;
  embeds: TranscriptEmbed[];
  attachments: string[];
}

export interface TranscriptMeta {
  number: number;
  type: string;
  openedBy: string;
  openedAt: number;
  closedBy: string;
  closedAt: number;
}

export function stamp(ms: number): string {
  return `${new Date(ms).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

/** Replaces <@id> mentions with @name where the name is known. */
export function resolveMentions(text: string, names: Map<string, string>): string {
  return text.replace(/<@!?(\d+)>/g, (whole, id: string) => (names.has(id) ? `@${names.get(id)}` : whole));
}

function indent(text: string): string {
  return text
    .split('\n')
    .map((line) => `    ${line}`)
    .join('\n');
}

/** A plain-text transcript, oldest message first, readable in Discord's file preview. */
export function buildTranscript(meta: TranscriptMeta, messages: TranscriptMessage[], names: Map<string, string> = new Map()): string {
  return transcriptText(
    [
      `T.C.P ticket ${formatTicketNumber(meta.number)} · ${meta.type}`,
      `Opened by ${meta.openedBy} on ${stamp(meta.openedAt)}`,
      `Closed by ${meta.closedBy} on ${stamp(meta.closedAt)}`,
    ],
    messages,
    names,
  );
}

/** A transcript under the given header lines: the message count, a rule, then every message. */
export function transcriptText(header: string[], messages: TranscriptMessage[], names: Map<string, string> = new Map()): string {
  const lines = [...header, `${messages.length} message${messages.length === 1 ? '' : 's'}`, '='.repeat(60)];
  for (const message of messages) {
    lines.push('', `[${stamp(message.at)}] ${message.author}${message.bot ? ' (bot)' : ''}`);
    if (message.content) lines.push(indent(resolveMentions(message.content, names)));
    for (const embed of message.embeds) {
      const parts = [
        embed.title ? `[${embed.title}]` : '',
        embed.description ?? '',
        ...(embed.fields ?? []).map((field) => `${field.name}: ${field.value}`),
      ].filter(Boolean);
      if (parts.length > 0) lines.push(indent(resolveMentions(parts.join('\n'), names)));
    }
    for (const url of message.attachments) lines.push(`    (attachment) ${url}`);
  }
  return `${lines.join('\n')}\n`;
}
