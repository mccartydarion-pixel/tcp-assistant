import { env } from './config/env.js';
import { logger } from './utils/logger.js';
import { Client, GatewayIntentBits } from 'discord.js';

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

client.once('clientReady', () => {
  logger.info(`Logged in as ${client.user?.tag ?? 'unknown user'}`);
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName === 'ping') {
    await interaction.reply('Pong!');
  }
});

await client.login(env.DISCORD_TOKEN);
logger.info('Discord client started');
