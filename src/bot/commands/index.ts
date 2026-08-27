import {
  EmbedBuilder,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type SlashCommandSubcommandsOnlyBuilder,
} from 'discord.js';
import type { AssistantService } from '../../ai/assistantService.js';
import type { KnowledgeService } from '../../knowledge/knowledgeService.js';
import { env } from '../../config/env.js';

export interface Command {
  data: SlashCommandBuilder | SlashCommandSubcommandsOnlyBuilder;
  execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
}

export interface BotStatus {
  databaseReady: boolean;
  knowledgeReady: boolean;
  commandsLoaded: number;
  commandsRegistered: number;
  startedAt: number;
}

export function createCommands(assistant: AssistantService, knowledge: KnowledgeService, status: BotStatus): Command[] {
  const tcp = new SlashCommandBuilder()
    .setName('tcp')
    .setDescription('T.C.P. Assistant commands')
    .addSubcommand((command) => command.setName('help').setDescription('Show T.C.P. Assistant help'))
    .addSubcommand((command) => command.setName('status').setDescription('Show assistant health and readiness'))
    .addSubcommand((command) =>
      command
        .setName('ask')
        .setDescription('Ask a T.C.P. technical question')
        .addStringOption((option) => option.setName('question').setDescription('Your question').setRequired(true)),
    );

  return [
    {
      data: tcp,
      async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();
        if (subcommand === 'help') {
          await interaction.reply('Use `/tcp ask` for a technical question or `/tcp status` to inspect assistant readiness. You can also mention T.C.P. Assistant in a support channel.');
          return;
        }

        if (subcommand === 'status') {
          if (env.OWNER_USER_ID && interaction.user.id !== env.OWNER_USER_ID) {
            await interaction.reply({ content: 'This command is restricted to the configured owner.', ephemeral: true });
            return;
          }
          const embed = new EmbedBuilder()
            .setTitle('T.C.P. Assistant Status')
            .addFields(
              { name: 'Discord', value: 'ONLINE', inline: true },
              { name: 'OpenAI', value: env.OPENAI_API_KEY ? 'CONFIGURED' : 'NOT CONFIGURED', inline: true },
              { name: 'Knowledge Base', value: `${status.knowledgeReady ? 'READY' : 'ERROR'}\nChunks: ${knowledge.chunkCount}`, inline: true },
              { name: 'Database', value: status.databaseReady ? 'CONNECTED' : 'ERROR', inline: true },
              { name: 'Commands', value: `${status.commandsLoaded} loaded`, inline: true },
              { name: 'Tickets', value: 'READY', inline: true },
              { name: 'Latency', value: `${interaction.client.ws.ping} ms`, inline: true },
              { name: 'Uptime', value: `${Math.floor((Date.now() - status.startedAt) / 1000)} seconds`, inline: true },
            )
            .setTimestamp();
          await interaction.reply({ embeds: [embed], ephemeral: true });
          return;
        }

        const question = interaction.options.getString('question', true).trim();
        await interaction.deferReply();
        loggerRequest();
        await interaction.editReply(await assistant.answer(question, [], interaction.client.user?.id));
      },
    },
  ];
}

function loggerRequest(): void {
  console.info('[TCP AI] Request started');
}
