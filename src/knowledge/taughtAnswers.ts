import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ChatInputCommandInteraction,
  type Interaction,
} from 'discord.js';
import { logger } from '../utils/logger.js';
import { notice } from '../bot/embeds.js';
import { isStaffUser } from '../bot/staff.js';
import { getState, setState } from '../database/stateStore.js';
import { extractKeywords } from './documentParser.js';
import type { KnowledgeService } from './knowledgeService.js';
import type { KnowledgeChunk } from './types.js';

// Teach the bot: when the assistant cannot answer a question, the report in the log channel has an
// "Answer this" button. Someone on the team writes the answer once, and it joins the assistant's knowledge
// at once, so the next member who asks gets it. /tcp teach adds one by hand, /tcp taught lists them,
// /tcp forget removes one. They live in the state store, beside the documentation, never in the repository.

const KEY = 'knowledge.taught';
const PREFIX = 'tcp-teach:';
const ANSWER_ID = `${PREFIX}answer`;
const MODAL_ID = `${PREFIX}modal`;
export const TAUGHT_SECTION = 'Answers from the T.C.P team';

export interface TaughtAnswer {
  id: number;
  question: string;
  answer: string;
  by: string;
  at: number;
}

let knowledge: KnowledgeService | null = null;

/** The taught answers as knowledge chunks, searched with the documentation. */
export function taughtChunks(list: TaughtAnswer[]): KnowledgeChunk[] {
  return list.map((entry) => ({
    id: `taught-${entry.id}`,
    section: TAUGHT_SECTION,
    subsection: entry.question.slice(0, 120),
    heading: entry.question.slice(0, 120),
    content: `Question: ${entry.question}\nAnswer: ${entry.answer}`,
    source: 'taught',
    keywords: extractKeywords(entry.question, entry.answer),
  }));
}

async function load(): Promise<TaughtAnswer[]> {
  return getState<TaughtAnswer[]>(KEY, []);
}

async function apply(list: TaughtAnswer[]): Promise<void> {
  knowledge?.setExtraChunks(taughtChunks(list));
}

export async function initTaughtAnswers(service: KnowledgeService): Promise<void> {
  knowledge = service;
  const list = await load();
  await apply(list);
  logger.info(`[TCP Knowledge] ${list.length} answer${list.length === 1 ? '' : 's'} taught by the team`);
}

async function addAnswer(question: string, answer: string, by: string): Promise<TaughtAnswer> {
  const list = await load();
  const entry: TaughtAnswer = { id: Math.max(0, ...list.map((item) => item.id)) + 1, question: question.trim(), answer: answer.trim(), by, at: Date.now() };
  const next = [...list, entry];
  await setState(KEY, next);
  await apply(next);
  logger.info(`[TCP Knowledge] ${by} taught answer #${entry.id}`);
  return entry;
}

/** The button on the "Question the bot couldn't answer" report. */
export function teachButtonRow() {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(ANSWER_ID).setLabel('Answer this').setStyle(ButtonStyle.Success));
}

/** The question in a report embed: its description without the quote marks. */
export function questionFromReport(description: string | null | undefined): string {
  return (description ?? '')
    .split('\n')
    .map((line) => line.replace(/^>\s?/, ''))
    .join('\n')
    .trim();
}

function answerModal(question: string) {
  return new ModalBuilder()
    .setCustomId(MODAL_ID)
    .setTitle('Teach the assistant')
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId('question').setLabel('Question').setStyle(TextInputStyle.Paragraph).setMaxLength(400).setRequired(true).setValue(question.slice(0, 400)),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('answer')
          .setLabel('The answer members should get')
          .setStyle(TextInputStyle.Paragraph)
          .setMaxLength(1500)
          .setRequired(true)
          .setPlaceholder('Write it as you would tell a member. The assistant will use it from now on.'),
      ),
    );
}

export async function handleTeachInteraction(interaction: Interaction): Promise<boolean> {
  if (!(interaction.isButton() || interaction.isModalSubmit()) || !interaction.customId.startsWith(PREFIX)) return false;
  if (!(await isStaffUser(interaction.guild, interaction.user.id))) {
    await interaction.reply({ ...notice('Only the T.C.P team can teach the assistant.', { tone: 'danger' }), ephemeral: true });
    return true;
  }
  if (interaction.isButton() && interaction.customId === ANSWER_ID) {
    await interaction.showModal(answerModal(questionFromReport(interaction.message.embeds[0]?.description)));
    return true;
  }
  if (interaction.isModalSubmit() && interaction.customId === MODAL_ID) {
    const question = interaction.fields.getTextInputValue('question');
    const answer = interaction.fields.getTextInputValue('answer');
    const entry = await addAnswer(question, answer, interaction.user.id);
    if (interaction.isFromMessage()) {
      const report = interaction.message.embeds[0];
      const embeds = report
        ? [
            EmbedBuilder.from(report)
              .setColor(0x2b8a3e)
              .addFields({ name: `✅ Answered by ${interaction.user.username}`, value: answer.slice(0, 1000) }),
          ]
        : [];
      await interaction.update({ embeds, components: [] });
      await interaction.followUp({ ...notice(`Saved as answer #${entry.id}. The assistant uses it from now on.`, { tone: 'success' }), ephemeral: true });
    } else {
      await interaction.reply({ ...notice(`Saved as answer #${entry.id}. The assistant uses it from now on.`, { tone: 'success' }), ephemeral: true });
    }
    return true;
  }
  return false;
}

/** /tcp teach, /tcp taught and /tcp forget (the team only). */
export async function handleTeachCommand(interaction: ChatInputCommandInteraction, subcommand: 'teach' | 'taught' | 'forget'): Promise<void> {
  if (!(await isStaffUser(interaction.guild, interaction.user.id))) {
    await interaction.reply({ ...notice('Only the T.C.P team can use this command.', { tone: 'danger' }), ephemeral: true });
    return;
  }
  if (subcommand === 'teach') {
    const entry = await addAnswer(interaction.options.getString('question', true), interaction.options.getString('answer', true), interaction.user.id);
    await interaction.reply({ ...notice(`Saved as answer #${entry.id}. The assistant uses it from now on.`, { tone: 'success' }), ephemeral: true });
    return;
  }
  const list = await load();
  if (subcommand === 'forget') {
    const id = interaction.options.getInteger('number', true);
    const next = list.filter((entry) => entry.id !== id);
    if (next.length === list.length) {
      await interaction.reply({ ...notice(`There is no answer #${id}. \`/tcp taught\` lists them.`, { tone: 'warning' }), ephemeral: true });
      return;
    }
    await setState(KEY, next);
    await apply(next);
    await interaction.reply({ ...notice(`Answer #${id} removed. The assistant no longer uses it.`, { tone: 'success' }), ephemeral: true });
    return;
  }
  const lines = list.map((entry) => `**#${entry.id}** ${entry.question.slice(0, 120)}\n> ${entry.answer.slice(0, 160).replace(/\n/g, ' ')}${entry.answer.length > 160 ? '...' : ''}`);
  await interaction.reply({
    ...notice(lines.length > 0 ? lines.join('\n').slice(0, 3900) : 'Nothing taught yet. Press **Answer this** on a report in the log channel, or use `/tcp teach`.', {
      title: `Answers taught by the team (${list.length})`,
    }),
    ephemeral: true,
  });
}
