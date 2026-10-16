import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type SlashCommandSubcommandsOnlyBuilder,
} from 'discord.js';
import type { AssistantService } from '../../ai/assistantService.js';
import type { KnowledgeService } from '../../knowledge/knowledgeService.js';
import { env } from '../../config/env.js';
import { SpecialIntentRouter } from '../../ai/specialIntentRouter.js';
import { ConversationMemory, detectFollowUpIntent } from '../../ai/conversationMemory.js';
import { extractQuestionDetails } from '../../ai/question.js';
import { reportUnanswered } from '../../ai/unanswered.js';
import { answerMessages, notice, tcpEmbed } from '../embeds.js';
import { serverMapFor } from '../../server/serverMap.js';
import { ticketAudience } from '../../tickets/ticketSystem.js';
import { handleReleaseCommand, handleTraceCommand } from '../../premium/premium.js';

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

export function createCommands(
  assistant: AssistantService,
  knowledge: KnowledgeService,
  status: BotStatus,
  specialIntentRouter: SpecialIntentRouter,
  memory: ConversationMemory,
): Command[] {
  const tcp = new SlashCommandBuilder()
    .setName('tcp')
    .setDescription('T.C.P. Assistant commands')
    .addSubcommand((command) => command.setName('help').setDescription('Show T.C.P. Assistant help'))
    .addSubcommand((command) => command.setName('status').setDescription('Show assistant health and readiness'))
    .addSubcommand((command) => command.setName('reset-session').setDescription('Clear your active T.C.P. support session'))
    .addSubcommand((command) =>
      command
        .setName('ask')
        .setDescription('Ask a T.C.P. technical question')
        .addStringOption((option) => option.setName('question').setDescription('Your question').setRequired(true)),
    )
    .addSubcommand((command) =>
      command
        .setName('release')
        .setDescription('Owner: upload the Premium script, or see which one is live')
        .addAttachmentOption((option) =>
          option.setName('file').setDescription('Tactical Competitive Pro Release.gpc (the scrambled build)').setRequired(false),
        ),
    )
    .addSubcommand((command) =>
      command
        .setName('trace')
        .setDescription('Owner: find out whose copy a leaked Premium script is')
        .addAttachmentOption((option) => option.setName('file').setDescription('The leaked .gpc file').setRequired(true)),
    );

  return [
    {
      data: tcp,
      async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();
        if (subcommand === 'release') {
          await handleReleaseCommand(interaction);
          return;
        }
        if (subcommand === 'trace') {
          await handleTraceCommand(interaction);
          return;
        }
        if (subcommand === 'help') {
          await interaction.reply({ embeds: [helpEmbed()], ephemeral: true });
          return;
        }

        if (subcommand === 'status') {
          if (env.OWNER_USER_ID && interaction.user.id !== env.OWNER_USER_ID) {
            await interaction.reply({ ...notice('Only the owner can use this command.', { tone: 'danger' }), ephemeral: true });
            return;
          }
          const embed = tcpEmbed({ title: 'T.C.P. Assistant Status' })
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

        if (!interaction.guildId) {
          await interaction.reply(notice('This command only works inside the T.C.P server.', { tone: 'muted' }));
          return;
        }

        if (subcommand === 'reset-session') {
          memory.reset(interaction.guildId, interaction.channelId, interaction.user.id);
          await interaction.reply({ ...notice('Your T.C.P. support session has been reset. Ask away!', { tone: 'success' }), ephemeral: true });
          return;
        }

        const question = interaction.options.getString('question', true).trim();
        console.info('[TCP Command] /tcp ask received');
        console.info('[TCP Intent] Checking special intent');
        if (interaction.guildId) {
          const intent = specialIntentRouter.check(interaction.guildId, interaction.channelId, interaction.user.id, question);
          if (intent) {
            console.info('[TCP Command] AI bypassed');
            await interaction.reply(specialIntentRouter.ownerResponse(!intent.shouldNotify));
            if (intent.shouldNotify) console.info('[TCP Escalation] Owner notified');
            return;
          }
        }
        const session = memory.getOrCreate(interaction.guildId, interaction.channelId, interaction.user.id);
        const followUpIntent = memory.updateFromQuestion(session, extractQuestionDetails(question), question);
        await interaction.deferReply();
        loggerRequest();
        // The answer is public: only channels the asker and its readers can both see (the ticket's member in a ticket).
        const audience = interaction.guild ? await ticketAudience(interaction.guild, interaction.channelId) : null;
        const serverMap = serverMapFor(interaction.guild, interaction.inCachedGuild() ? interaction.member : null, audience);
        const result = await assistant.answerDetailed(question, session.turns, interaction.client.user?.id, session.tuning, followUpIntent, serverMap);
        memory.record(session, question, result.text);
        const [first, ...rest] = answerMessages(result.text, { title: 'T.C.P. Assistant' });
        await interaction.editReply(first!);
        for (const part of rest) await interaction.followUp(part);
        if (result.unanswered) {
          await reportUnanswered(interaction.client, {
            question,
            userId: interaction.user.id,
            where: `<#${interaction.channelId}> (/tcp ask)`,
            sources: result.sources,
          });
        }
      },
    },
  ];
}

/** What the assistant can do, for /tcp help. */
export function helpEmbed() {
  const lines = [
    env.HELP_CHANNEL_ID
      ? `**Ask a question:** post it in <#${env.HELP_CHANNEL_ID}>, no @mention needed, or use \`/tcp ask\`.`
      : '**Ask a question:** @mention **T.C.P. Assistant**, or use `/tcp ask`.',
    '**Open a ticket:** for anything the assistant cannot solve, press **Open a ticket** on the support panel.',
    '**Start over:** `/tcp reset-session` clears your conversation with the assistant.',
  ];
  return tcpEmbed({ title: 'T.C.P. Assistant', description: lines.join('\n') });
}

function loggerRequest(): void {
  console.info('[TCP AI] Request started');
}
