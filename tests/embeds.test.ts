import { describe, expect, it } from 'vitest';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { answerMessages, COLOURS, FOOTER_TEXT, finalNotice, notice, setBrandIcon, splitText, tcpEmbed } from '../src/bot/embeds.js';

describe('T.C.P embed style', () => {
  it('uses the T.C.P red and the shared footer by default', () => {
    const embed = tcpEmbed({ title: 'Hello', description: 'World' }).toJSON();
    expect(embed.color).toBe(COLOURS.brand);
    expect(embed.footer?.text).toBe(FOOTER_TEXT);
    expect(embed.footer?.icon_url).toBeUndefined();
  });

  it('puts the logo in the footer once the bot knows its avatar', () => {
    setBrandIcon('https://cdn.example/avatar.png');
    expect(tcpEmbed().toJSON().footer?.icon_url).toBe('https://cdn.example/avatar.png');
    setBrandIcon(undefined);
  });

  it('cuts text that is over Discord limits instead of failing', () => {
    const embed = tcpEmbed({
      title: 'x'.repeat(300),
      description: 'y'.repeat(5000),
      fields: [{ name: 'n', value: 'z'.repeat(2000) }, { name: '', value: '' }],
    }).toJSON();
    expect(embed.title).toHaveLength(256);
    expect(embed.description).toHaveLength(4096);
    expect(embed.fields?.[0]?.value).toHaveLength(1024);
    expect(embed.fields?.[1]?.name).toBe('​');
  });

  it('wraps a short message as one embed, in the tone asked for', () => {
    const message = notice('Saved', { tone: 'success', title: 'Done' });
    expect(message.embeds).toHaveLength(1);
    expect(message.embeds[0]!.toJSON()).toMatchObject({ title: 'Done', description: 'Saved', color: COLOURS.success });
  });

  it('clears the text and buttons when a wizard ends', () => {
    const message = finalNotice('Cancelled.');
    expect(message.content).toBe('');
    expect(message.components).toEqual([]);
    expect(message.embeds[0]!.toJSON().description).toBe('Cancelled.');
  });
});

describe('long answers', () => {
  it('leaves a short answer whole', () => {
    expect(splitText('Raise Vertical by 1.')).toEqual(['Raise Vertical by 1.']);
  });

  it('splits at paragraphs, and every piece fits an embed', () => {
    const paragraph = 'word '.repeat(150).trim();
    const text = Array.from({ length: 12 }, () => paragraph).join('\n\n');
    const pieces = splitText(text, 1000);
    expect(pieces.length).toBeGreaterThan(1);
    for (const piece of pieces) {
      expect(piece.length).toBeLessThanOrEqual(1000);
      expect(piece.startsWith('word')).toBe(true);
    }
    expect(pieces.join(' ').replace(/\s+/g, ' ')).toBe(text.replace(/\s+/g, ' '));
  });

  it('still splits text with no spaces at all', () => {
    expect(splitText('a'.repeat(2500), 1000).map((piece) => piece.length)).toEqual([1000, 1000, 500]);
  });

  it('sends one embed per message, titles only the first and puts buttons on the last', () => {
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId('x').setLabel('Solved').setStyle(ButtonStyle.Success));
    // Two 3000-character paragraphs: too long for one embed, split between them.
    const messages = answerMessages(`${'a '.repeat(1500)}\n\n${'b '.repeat(1500)}`, { title: 'Answer' }, [row]);
    expect(messages).toHaveLength(2);
    expect((messages[0]!.embeds![0] as ReturnType<typeof tcpEmbed>).toJSON().title).toBe('Answer');
    expect((messages[1]!.embeds![0] as ReturnType<typeof tcpEmbed>).toJSON().title).toBeUndefined();
    expect(messages[0]!.components).toEqual([]);
    expect(messages[1]!.components).toEqual([row]);
  });
});
