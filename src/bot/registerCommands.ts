import { REST, Routes } from 'discord.js';
import type { Command } from './commands/index.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

export async function registerCommands(commands: Command[]): Promise<number> {
  const rest = new REST({ version: '10' }).setToken(env.DISCORD_TOKEN);
  const body = commands.map((command) => command.data.toJSON());

  try {
    await rest.put(Routes.applicationGuildCommands(env.DISCORD_CLIENT_ID, env.DISCORD_GUILD_ID), { body });
    logger.info(`[TCP Commands] Registered ${body.length} guild commands.`);
    return body.length;
  } catch (error) {
    logger.error({ err: error }, '[TCP Commands ERROR] Guild command registration failed');
    throw error;
  }
}
