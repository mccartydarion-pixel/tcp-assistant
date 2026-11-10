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
import { handleReleaseCommand, handleSyncCommand, handleTraceCommand } from '../../premium/premium.js';
import { handleAnnouncementsCommand } from '../../announcements/announcements.js';
import { handleAuditCommand } from '../../premium/eliteAudit.js';
import { handleStatsCommand } from '../../owner/stats.js';
import { handleHoursCommand } from '../../tickets/supportHours.js';
import { handleTicTacToeCommand } from '../../fun/ticTacToe.js';
import { handleTeachCommand } from '../../knowledge/taughtAnswers.js';
import { handleTuneCommand } from '../../tuning/tuningWizard.js';
import { askChannelRedirect, assistantAllowedIn } from '../askChannel.js';

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
          option.setName('file').setDescription('T.C.P Premium.gpc from the Premium folder (the scrambled build)').setRequired(false),
        )
        .addStringOption((option) =>
          option.setName('notes').setDescription("What changed (sent to Elite Supporters with the file)").setMaxLength(1500).setRequired(false),
        )
        .addBooleanOption((option) =>
          option.setName('notify').setDescription('DM every Elite Supporter their copy (default: yes)').setRequired(false),
        ),
    )
    .addSubcommand((command) =>
      command
        .setName('trace')
        .setDescription('Owner: find out whose copy a leaked Premium script is')
        .addAttachmentOption((option) => option.setName('file').setDescription('The leaked .gpc file').setRequired(true)),
    )
    .addSubcommand((command) =>
      command
        .setName('sync')
        .setDescription('Owner: give a paying member the Elite welcome: role, script by DM, welcome post')
        .addUserOption((option) => option.setName('member').setDescription('Who to sync (leave empty for yourself)').setRequired(false)),
    )
    .addSubcommand((command) =>
      command
        .setName('announcements')
        .setDescription('Owner: list the queued announcements and whether each is posted')
        .addStringOption((option) =>
          option
            .setName('retry')
            .setDescription('Id of an entry marked UNSURE: check the channel first; this clears it and posts it')
            .setRequired(false)
            .setMaxLength(80),
        ),
    )
    .addSubcommand((command) => command.setName('tune').setDescription('Fix my aim: a step-by-step walk-through for recoil and aim problems'))
    .addSubcommand((command) =>
      command
        .setName('tictactoe')
        .setDescription('Play Tic Tac Toe against T.C.P')
        .addStringOption((option) =>
          option
            .setName('difficulty')
            .setDescription('How well T.C.P plays (default Normal)')
            .setRequired(false)
            .addChoices({ name: 'Easy', value: 'easy' }, { name: 'Normal', value: 'normal' }, { name: 'Hard (unbeatable)', value: 'hard' }),
        ),
    )
    .addSubcommand((command) => command.setName('stats').setDescription('Owner: subscribers, revenue, license holders and support this week'))
    .addSubcommand((command) => command.setName('audit').setDescription('Owner: who holds the Elite role without a subscription or days'))
    .addSubcommand((command) =>
      command
        .setName('hours')
        .setDescription('Owner: set the support hours shown on the ticket panel (no options: show them)')
        .addStringOption((option) => option.setName('from').setDescription('Opening time, for example 10:00 or 10am').setRequired(false).setMaxLength(10))
        .addStringOption((option) => option.setName('to').setDescription('Closing time, for example 22:00 or 10pm').setRequired(false).setMaxLength(10))
        .addStringOption((option) =>
          option.setName('timezone').setDescription('Your time zone, for example America/New_York or Europe/London').setRequired(false).setMaxLength(60),
        )
        .addStringOption((option) =>
          option.setName('days').setDescription('every day, weekdays, weekends, mon-fri or mon,wed,fri (default every day)').setRequired(false).setMaxLength(60),
        )
        .addBooleanOption((option) => option.setName('off').setDescription('True: turn the support hours off').setRequired(false)),
    )
    .addSubcommand((command) =>
      command
        .setName('teach')
        .setDescription('Team: teach the assistant an answer it uses from now on')
        .addStringOption((option) => option.setName('question').setDescription('The question members ask').setRequired(true).setMaxLength(400))
        .addStringOption((option) => option.setName('answer').setDescription('The answer they should get').setRequired(true).setMaxLength(1500)),
    )
    .addSubcommand((command) => command.setName('taught').setDescription('Team: list the answers taught to the assistant'))
    .addSubcommand((command) =>
      command
        .setName('forget')
        .setDescription('Team: remove a taught answer')
        .addIntegerOption((option) => option.setName('number').setDescription('Its number in /tcp taught').setRequired(true).setMinValue(1)),
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
        if (subcommand === 'sync') {
          await handleSyncCommand(interaction);
          return;
        }
        if (subcommand === 'announcements') {
          await handleAnnouncementsCommand(interaction);
          return;
        }
        if (subcommand === 'tune') {
          await handleTuneCommand(interaction);
          return;
        }
        if (subcommand === 'tictactoe') {
          await handleTicTacToeCommand(interaction);
          return;
        }
        if (subcommand === 'stats') {
          await handleStatsCommand(interaction);
          return;
        }
        if (subcommand === 'audit') {
          await handleAuditCommand(interaction);
          return;
        }
        if (subcommand === 'hours') {
          await handleHoursCommand(interaction);
          return;
        }
        if (subcommand === 'teach' || subcommand === 'taught' || subcommand === 'forget') {
          await handleTeachCommand(interaction, subcommand);
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
        // Only in the help channel (#ask-tcp) and its threads, or in a support ticket; elsewhere, a pointer there.
        const askChannel = interaction.channel;
        const parentId = askChannel && 'parentId' in askChannel ? askChannel.parentId : null;
        const isTicket = Boolean(env.SUPPORT_CATEGORY_ID) && parentId === env.SUPPORT_CATEGORY_ID;
        if (!assistantAllowedIn({ channelId: interaction.channelId, parentId, isTicket })) {
          await interaction.reply({ ...notice(askChannelRedirect(), { tone: 'muted' }), ephemeral: true });
          return;
        }
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
      ? `**Ask a question:** post it in <#${env.HELP_CHANNEL_ID}>, no @mention needed. The assistant only answers there (and in your support ticket).`
      : '**Ask a question:** @mention **T.C.P. Assistant**, or use `/tcp ask`.',
    '**Open a ticket:** for anything the assistant cannot solve, press **Open a ticket** on the support panel.',
    '**Start over:** `/tcp reset-session` clears your conversation with the assistant.',
    '**Take a break:** `/tcp tictactoe` for a game of Tic Tac Toe against T.C.P (Easy, Normal or Hard).',
  ];
  return tcpEmbed({ title: 'T.C.P. Assistant', description: lines.join('\n') });
}

function loggerRequest(): void {
  console.info('[TCP AI] Request started');
}
