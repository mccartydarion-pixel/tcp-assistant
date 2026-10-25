import { env } from './config/env.js';
import { logger } from './utils/logger.js';
import { Client, Events, GatewayCloseCodes, GatewayIntentBits } from 'discord.js';
import { initializeDatabase } from './database/client.js';
import { AssistantService } from './ai/assistantService.js';
import { KnowledgeService } from './knowledge/knowledgeService.js';
import { isOpenAiConfigured } from './services/openai.js';
import { createCommands, type BotStatus, type Command } from './bot/commands/index.js';
import { registerCommands } from './bot/registerCommands.js';
import { registerEvents } from './bot/events.js';
import { SpecialIntentRouter } from './ai/specialIntentRouter.js';
import { ConversationMemory } from './ai/conversationMemory.js';
import { ensureLicensePanel, grantPaidDays, grantPaidUntil, refreshLicensePanel } from './license/licensePanel.js';
import { startBoostRewards } from './license/boostRewards.js';
import { ensureEliteHub } from './premium/eliteHub.js';
import { ensureSettingsPanel } from './settings/settingsPanel.js';
import { ensureBugPanel } from './bugs/bugReports.js';
import { ensureReviewPanel } from './reviews/reviews.js';
import { ensureGamePanels } from './games/gameScripts.js';
import { ensureInfoChannels } from './info/infoChannels.js';
import { ensureWelcomePanel, setMemberEventsActive, wantsMemberEvents } from './welcome/welcome.js';
import { setBrandIcon } from './bot/embeds.js';
import { initTickets } from './tickets/ticketSystem.js';
import { ensureHelpPanel, initHelpChannel } from './help/helpChannel.js';
import { startHelpCleanup } from './help/helpCleanup.js';
import { hasLiveSubscription, initPayments, paymentsConfigured } from './payments/stripeBilling.js';
import { initPremium, onPremiumEnded, onPremiumPaid } from './premium/premium.js';
import { startHttpServer } from './server/httpServer.js';
import { initAnnouncements } from './announcements/announcements.js';

const knowledge = new KnowledgeService();
const assistant = new AssistantService(knowledge);
const specialIntentRouter = new SpecialIntentRouter();
const conversationMemory = new ConversationMemory();
const status: BotStatus = {
  databaseReady: false,
  knowledgeReady: false,
  commandsLoaded: 0,
  commandsRegistered: 0,
  startedAt: Date.now(),
};

// How long to wait for Discord to confirm the connection before carrying on anyway.
const READY_TIMEOUT_MS = 60_000;

function createClient(commands: Command[], withMembers: boolean): Client {
  const intents = [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent];
  // Server Members Intent: lets the bot see members joining, for the welcome greeting. It is privileged,
  // so Discord refuses the connection unless it is switched on in the Developer Portal.
  if (withMembers) intents.push(GatewayIntentBits.GuildMembers);
  const client = new Client({ intents });
  client.commands = new Map(commands.map((command) => [command.data.name, command]));
  // discord.js turns a failed async listener into an 'error' event; without a listener that would end the process.
  client.on(Events.Error, (error) => logger.error({ err: error }, '[TCP Discord ERROR] Unhandled client error'));
  registerEvents(client, assistant, specialIntentRouter, conversationMemory);
  client.once(Events.ClientReady, (readyClient) => {
    // The bot's avatar is the T.C.P logo: it becomes the footer icon on every embed.
    setBrandIcon(readyClient.user.displayAvatarURL({ size: 128 }));
    logger.info(`[TCP Discord] Logged in as ${readyClient.user.tag}`);
    logger.info(`[TCP Discord] Logged-in bot ID: ${readyClient.user.id}`);
    logger.info('T.C.P. Assistant ONLINE');
  });
  return client;
}

function isDisallowedIntents(error: unknown): boolean {
  const details = error as { code?: unknown; message?: unknown } | undefined;
  return details?.code === 'DisallowedIntents' || /disallowed intents|not enabled or whitelisted/i.test(String(details?.message ?? ''));
}

/**
 * Logs in and waits for Discord to confirm. If the Server Members Intent was asked for and Discord refuses
 * it (it is off in the Developer Portal), logs why and connects again without it, so the bot stays up.
 */
async function connect(commands: Command[], withMembers: boolean): Promise<Client> {
  const client = createClient(commands, withMembers);
  const outcome = new Promise<'ready' | 'refused' | 'timeout'>((resolve) => {
    client.once(Events.ClientReady, () => resolve('ready'));
    client.on(Events.ShardDisconnect, (event) => {
      if (event.code === GatewayCloseCodes.DisallowedIntents) resolve('refused');
    });
    setTimeout(() => resolve('timeout'), READY_TIMEOUT_MS);
  });

  let refused = false;
  try {
    await client.login(env.DISCORD_TOKEN);
    refused = (await outcome) === 'refused';
  } catch (error) {
    if (!withMembers || !isDisallowedIntents(error)) throw error;
    refused = true;
  }

  if (refused) {
    if (!withMembers) throw new Error('Discord refused the connection: a privileged intent is not enabled.');
    logger.error(
      '[TCP Discord ERROR] Discord refused the Server Members Intent. Switch on "Server Members Intent" under Bot in the Discord Developer Portal. Connecting without it; new members are greeted from Discord\'s join messages instead.',
    );
    await client.destroy();
    return connect(commands, false);
  }

  setMemberEventsActive(withMembers);
  logger.info(withMembers ? '[TCP Welcome] Server Members Intent on: new members are greeted as they join.' : '[TCP Welcome] Greeting new members from Discord\'s join messages.');
  return client;
}

async function validateGuildConfiguration(client: Client): Promise<void> {
  // Ask Discord for the full server details rather than any placeholder in the cache.
  const guild = await client.guilds.fetch({ guild: env.DISCORD_GUILD_ID, force: true });
  logger.info(`[TCP Discord] Guild found: ${guild.name}`);

  if (env.SUPPORT_CATEGORY_ID) {
    let category;
    try {
      category = await guild.channels.fetch(env.SUPPORT_CATEGORY_ID);
    } catch (error) {
      logger.warn({ err: error }, '[TCP Config] Could not resolve SUPPORT_CATEGORY_ID.');
    }
    if (!category || category.type !== 4) {
      logger.error('[TCP Config ERROR] SUPPORT_CATEGORY_ID does not match a valid category.');
    } else {
      logger.info(`[TCP Config] Support category found: ${category.name}`);
    }
  }

  for (const [name, channelId] of Object.entries({
    INFO_FAQ_CHANNEL_ID: env.INFO_FAQ_CHANNEL_ID,
    INFO_RULES_CHANNEL_ID: env.INFO_RULES_CHANNEL_ID,
    INFO_DISCLAIMER_CHANNEL_ID: env.INFO_DISCLAIMER_CHANNEL_ID,
    INFO_OVERVIEW_CHANNEL_ID: env.INFO_OVERVIEW_CHANNEL_ID,
    DOWNLOAD_CHANNEL_ID: env.DOWNLOAD_CHANNEL_ID,
    LOG_CHANNEL_ID: env.LOG_CHANNEL_ID,
    BUG_REPORT_CHANNEL_ID: env.BUG_REPORT_CHANNEL_ID,
    ANNOUNCEMENT_CHANNEL_ID: env.ANNOUNCEMENT_CHANNEL_ID,
    REVIEW_CHANNEL_ID: env.REVIEW_CHANNEL_ID,
    REVIEW_VOICE_CHANNEL_ID: env.REVIEW_VOICE_CHANNEL_ID,
    WELCOME_CHANNEL_ID: env.WELCOME_CHANNEL_ID,
    HELP_CHANNEL_ID: env.HELP_CHANNEL_ID,
    TICKET_LOG_CHANNEL_ID: env.TICKET_LOG_CHANNEL_ID,
    TICKET_PANEL_CHANNEL_ID: env.TICKET_PANEL_CHANNEL_ID,
  })) {
    if (!channelId) continue;
    try {
      const channel = await guild.channels.fetch(channelId);
      if (!channel) logger.warn(`[TCP Config] ${name} does not resolve to a channel in the configured guild.`);
    } catch (error) {
      logger.warn({ err: error }, `[TCP Config] ${name} could not be resolved.`);
    }
  }
}

async function start(): Promise<void> {
  logger.info('====================================');
  logger.info('T.C.P. ASSISTANT STARTUP');
  logger.info('====================================');
  logger.info(`Environment: ${env.NODE_ENV}`);
  logger.info(env.OWNER_USER_ID ? '[TCP Escalation] Owner configured.' : '[TCP Escalation WARNING] OWNER_USER_ID not configured.');
  logger.info('[TCP Discord] MessageContent intent configured. Enable it in the Discord Developer Portal too.');

  try {
    initializeDatabase();
    status.databaseReady = true;
    logger.info('[TCP Database] READY');
  } catch (error) {
    logger.error({ err: error }, '[TCP Database ERROR] Initialization failed');
  }

  try {
    await knowledge.initialize();
    status.knowledgeReady = true;
    logger.info(`[TCP Knowledge] READY (${knowledge.chunkCount} chunks)`);
  } catch (error) {
    logger.error({ err: error }, '[TCP Knowledge ERROR] Initialization failed');
  }

  logger.info(isOpenAiConfigured() ? '[TCP AI] OpenAI configured.' : '[TCP AI ERROR] OPENAI_API_KEY missing.');

  initHelpChannel({ assistant, memory: conversationMemory, router: specialIntentRouter });
  const commands = createCommands(assistant, knowledge, status, specialIntentRouter, conversationMemory);
  status.commandsLoaded = commands.length;
  logger.info(`[TCP Commands] Loaded ${commands.length} commands.`);
  const client = await connect(commands, wantsMemberEvents());
  await validateGuildConfiguration(client);
  status.commandsRegistered = await registerCommands(commands);
  logger.info('[TCP Ticket] Ticket Assistant: READY');
  // Before the licence panel, so it shows Subscribe with the live price and Download Premium.
  await initPremium(client, { isSubscriber: hasLiveSubscription, onUploaded: () => Promise.all([refreshLicensePanel(client), ensureEliteHub(client)]).then(() => undefined) });
  await initPayments(client, {
    grantDays: (discordUserId, days) => grantPaidDays(client, discordUserId, days),
    grantUntil: (discordUserId, until) => grantPaidUntil(client, discordUserId, until),
    onPaid: (discordUserId, first) => onPremiumPaid(client, discordUserId, first),
    onEnded: (discordUserId) => onPremiumEnded(client, discordUserId),
  });
  if (paymentsConfigured()) startHttpServer(env.PORT);
  await ensureLicensePanel(client);
  startBoostRewards(client);
  await ensureEliteHub(client);
  await initTickets(client, { assistant, memory: conversationMemory });
  await ensureHelpPanel(client);
  startHelpCleanup(client);
  await ensureSettingsPanel(client);
  await ensureBugPanel(client);
  await ensureReviewPanel(client);
  await ensureGamePanels(client);
  await ensureWelcomePanel(client);
  await ensureInfoChannels(client);
  // Last, once every panel is in place: posts the code-written announcements that are due (queue.ts).
  await initAnnouncements(client);
}

start().catch((error) => {
  logger.error({ err: error }, '[TCP Startup ERROR] Application initialization failed');
  process.exitCode = 1;
});
