import { EmbedBuilder, type APIEmbedField, type BaseMessageOptions } from 'discord.js';

// One look for every message the bot sends: T.C.P red by default, and the same footer with the bot's own
// avatar (the T.C.P logo) as its icon. Cards that already have their own colour or footer keep them.
export const COLOURS = {
  brand: 0xe8352b,
  success: 0x2b8a3e,
  warning: 0xf59f00,
  danger: 0xc92a2a,
  muted: 0x868e96,
} as const;
export type Tone = keyof typeof COLOURS;

export const FOOTER_TEXT = 'T.C.P Assistant';
/** Discord's limit on one embed's description. Answers are split below it. */
export const EMBED_TEXT_LIMIT = 4000;

let brandIcon: string | undefined;

/** Called once the bot is logged in, with its avatar: the footer icon on every embed. */
export function setBrandIcon(url: string | undefined): void {
  brandIcon = url;
}

/** The bot's avatar (the T.C.P logo), once logged in. */
export function getBrandIcon(): string | undefined {
  return brandIcon;
}

export interface EmbedOptions {
  title?: string;
  description?: string;
  tone?: Tone;
  fields?: APIEmbedField[];
  footer?: string;
  thumbnail?: string;
  timestamp?: boolean;
}

/** An embed in the T.C.P style. Text over Discord's limits is cut rather than rejected. */
export function tcpEmbed(options: EmbedOptions = {}): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(COLOURS[options.tone ?? 'brand'])
    .setFooter(brandIcon ? { text: options.footer ?? FOOTER_TEXT, iconURL: brandIcon } : { text: options.footer ?? FOOTER_TEXT });
  if (options.title) embed.setTitle(options.title.slice(0, 256));
  if (options.description) embed.setDescription(options.description.slice(0, 4096));
  if (options.fields?.length) {
    embed.addFields(
      options.fields.slice(0, 25).map((field) => ({
        name: field.name.slice(0, 256) || '​',
        value: field.value.slice(0, 1024) || '​',
        inline: field.inline,
      })),
    );
  }
  if (options.thumbnail) embed.setThumbnail(options.thumbnail);
  if (options.timestamp) embed.setTimestamp();
  return embed;
}

/** A short message (a reply, confirmation or error) as a T.C.P embed. */
export function notice(description: string, options: Omit<EmbedOptions, 'description'> = {}): { embeds: EmbedBuilder[] } {
  return { embeds: [tcpEmbed({ ...options, description })] };
}

/** Replaces a wizard's own message with a closing notice and no buttons. */
export function finalNotice(description: string, options: Omit<EmbedOptions, 'description'> = {}) {
  return { content: '', embeds: [tcpEmbed({ ...options, description })], components: [] };
}

/** Splits text into pieces that each fit one embed: at paragraphs, then lines, then spaces. */
export function splitText(text: string, limit = EMBED_TEXT_LIMIT): string[] {
  const pieces: string[] = [];
  let rest = text.trim();
  while (rest.length > limit) {
    const window = rest.slice(0, limit);
    let cut = window.lastIndexOf('\n\n');
    if (cut < limit / 2) cut = window.lastIndexOf('\n');
    if (cut < limit / 2) cut = window.lastIndexOf(' ');
    if (cut <= 0) cut = limit;
    pieces.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest) pieces.push(rest);
  return pieces;
}

/** An answer as one embed per piece; only the first carries the title. One piece per message fits Discord's limits. */
export function answerEmbeds(text: string, options: Omit<EmbedOptions, 'description'> = {}): EmbedBuilder[] {
  const pieces = splitText(text);
  if (pieces.length === 0) pieces.push('​');
  return pieces.map((piece, index) => tcpEmbed({ ...options, title: index === 0 ? options.title : undefined, description: piece }));
}

/** An answer as messages to send in order: one embed each, with any buttons on the last. */
export function answerMessages(
  text: string,
  options: Omit<EmbedOptions, 'description'> = {},
  components: NonNullable<BaseMessageOptions['components']> = [],
): BaseMessageOptions[] {
  const embeds = answerEmbeds(text, options);
  return embeds.map((embed, index) => ({ embeds: [embed], components: index === embeds.length - 1 ? components : [] }));
}
