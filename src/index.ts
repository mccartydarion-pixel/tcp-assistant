import { env } from './config/env.js';
import { logger } from './utils/logger.js';
import { Client, Events, GatewayIntentBits } from 'discord.js';
import { initializeDatabase } from './database/client.js';
import { AssistantService } from './ai/assistantService.js';
import { KnowledgeService } from './knowledge/knowledgeService.js';
import { isOpenAiConfigured } from './services/openai.js';
import { createCommands, type BotStatus } from './bot/commands/index.js';
import { registerCommands } from './bot/registerCommands.js';
import { registerEvents } from './bot/events.js';
import { SpecialIntentRouter } from './ai/specialIntentRouter.js';

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});
const knowledge = new KnowledgeService();
const assistant = new AssistantService(knowledge);
const specialIntentRouter = new SpecialIntentRouter();
const status: BotStatus = {
  databaseReady: false,
  knowledgeReady: false,
  commandsLoaded: 0,
  commandsRegistered: 0,
  startedAt: Date.now(),
};

client.commands = new Map();

async function validateGuildConfiguration(): Promise<void> {
  const guild = await client.guilds.fetch(env.DISCORD_GUILD_ID);
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
    FAQ_CHANNEL_ID: env.FAQ_CHANNEL_ID,
    DOWNLOAD_CHANNEL_ID: env.DOWNLOAD_CHANNEL_ID,
    LOG_CHANNEL_ID: env.LOG_CHANNEL_ID,
    BUG_REPORT_CHANNEL_ID: env.BUG_REPORT_CHANNEL_ID,
    ANNOUNCEMENT_CHANNEL_ID: env.ANNOUNCEMENT_CHANNEL_ID,
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

  const commands = createCommands(assistant, knowledge, status, specialIntentRouter);
  client.commands = new Map(commands.map((command) => [command.data.name, command]));
  status.commandsLoaded = commands.length;
  logger.info(`[TCP Commands] Loaded ${commands.length} commands.`);
  registerEvents(client, assistant, specialIntentRouter);
  await client.login(env.DISCORD_TOKEN);
  await validateGuildConfiguration();
  status.commandsRegistered = await registerCommands(commands);
  logger.info('[TCP Ticket] Ticket Assistant: READY');
}

client.once(Events.ClientReady, (readyClient) => {
  logger.info(`[TCP Discord] Logged in as ${readyClient.user.tag}`);
  logger.info('T.C.P. Assistant ONLINE');
});

start().catch((error) => {
  logger.error({ err: error }, '[TCP Startup ERROR] Application initialization failed');
  process.exitCode = 1;
});
