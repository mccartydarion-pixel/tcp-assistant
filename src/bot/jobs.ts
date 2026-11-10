import type { Collection, Guild, GuildMember, Role } from 'discord.js';
import { getState, setState } from '../database/stateStore.js';
import { logger } from '../utils/logger.js';
import { isMemberEventsActive } from '../welcome/welcome.js';

// Background jobs. A daily or weekly job remembers when it last ran in the state store, so a redeploy
// neither runs it twice nor skips it; it is checked every few minutes and runs once its period has passed.

const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;

const running = new Set<string>();

/**
 * Runs the job every periodMs from its last run. The first check is firstCheckMs after startup (so the
 * bot's panels are in place), then every checkMs. A failure is logged and the job runs again next period.
 */
export function scheduleJob(
  name: string,
  periodMs: number,
  job: () => Promise<void>,
  options: { firstCheckMs?: number; checkMs?: number } = {},
): void {
  const check = async () => {
    if (running.has(name)) return;
    running.add(name);
    try {
      const last = await getState<number>(`job.${name}`, 0);
      if (Date.now() - last < periodMs) return;
      // Recorded first, so a crash halfway never makes it run again at once.
      await setState(`job.${name}`, Date.now());
      logger.info(`[TCP Jobs] Running ${name}`);
      await job();
    } catch (error) {
      logger.error({ err: error }, `[TCP Jobs ERROR] ${name} failed`);
    } finally {
      running.delete(name);
    }
  };
  setTimeout(() => void check(), options.firstCheckMs ?? 2 * 60 * 1000).unref();
  setInterval(() => void check(), options.checkMs ?? 10 * 60 * 1000).unref();
}

/** Runs the task every intervalMs (no memory across restarts), first after firstMs. Never overlaps itself. */
export function everyInterval(name: string, intervalMs: number, task: () => Promise<void>, firstMs = 60 * 1000): void {
  const run = async () => {
    if (running.has(name)) return;
    running.add(name);
    try {
      await task();
    } catch (error) {
      logger.error({ err: error }, `[TCP Jobs ERROR] ${name} failed`);
    } finally {
      running.delete(name);
    }
  };
  setTimeout(() => void run(), firstMs).unref();
  setInterval(() => void run(), intervalMs).unref();
}

/**
 * Every member of the server. With the Server Members Intent the whole list is fetched; without it only the
 * members Discord has sent the bot are known, so `complete` is false.
 */
export async function allMembers(guild: Guild): Promise<{ members: Collection<string, GuildMember>; complete: boolean }> {
  if (isMemberEventsActive()) {
    try {
      return { members: await guild.members.fetch(), complete: true };
    } catch (error) {
      logger.warn({ err: error }, '[TCP Jobs] Could not fetch every member; using the ones the bot already knows');
    }
  }
  return { members: guild.members.cache, complete: false };
}

/** Every member with this role (see allMembers for `complete`). */
export async function roleMembers(guild: Guild, role: Role): Promise<{ members: GuildMember[]; complete: boolean }> {
  const { members, complete } = await allMembers(guild);
  return { members: [...members.values()].filter((member) => !member.user.bot && member.roles.cache.has(role.id)), complete };
}
