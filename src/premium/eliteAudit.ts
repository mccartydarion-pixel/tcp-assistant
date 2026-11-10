import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ChatInputCommandInteraction,
  type Client,
  type Guild,
  type GuildMember,
  type Interaction,
  type Role,
} from 'discord.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { fetchSendableChannel } from '../bot/panels.js';
import { notice, tcpEmbed, type Tone } from '../bot/embeds.js';
import { isSafeSelfRole, plainName } from '../bot/roles.js';
import { isStaffMember } from '../bot/staff.js';
import { allMembers, DAY_MS, scheduleJob } from '../bot/jobs.js';
import { getState, setState } from '../database/stateStore.js';
import { LIVE_STATUSES } from '../payments/paymentRules.js';
import { listStripeSubscriptions, type StripeSubscriptionInfo } from '../payments/stripeBilling.js';
import { licenceExpiry, licenceRecordsOpen } from '../license/licensePanel.js';
import { eliteRole, eliteWelcomeChannel } from './premium.js';

// Once a day the bot checks the Elite Supporter role and the Veteran roles against what members pay for.
//  - The Elite role stays with the team (owner, staff, Administrators), anyone with a live subscription and
//    anyone with license days left (days the owner added, boost rewards). Everyone else loses it. If that would
//    take it from more than a few members at once (a payment outage, or a bug), nothing is removed and the owner
//    is told; /tcp audit shows the list and can remove them after a look.
//  - Veteran roles: a member whose subscription has run 3, 6 or 12 months without a break gets "Veteran ·
//    3 Months", "6 Months" or "1 Year" (only the highest), and a shout-out in the elite welcome channel when
//    they reach one. They go when the subscription ends.

const PREFIX = 'tcp-audit:';
const APPLY_ID = `${PREFIX}apply`;
const MONTH_MS = 30.4375 * DAY_MS;

export const VETERAN_TIERS = [
  { months: 12, name: 'Veteran · 1 Year', colour: 0xf1c40f, label: 'a year' },
  { months: 6, name: 'Veteran · 6 Months', colour: 0xbdc3c7, label: '6 months' },
  { months: 3, name: 'Veteran · 3 Months', colour: 0xcd7f32, label: '3 months' },
] as const;

export function monthsSubscribed(startedAt: number, now: number): number {
  return Math.max(0, Math.floor((now - startedAt) / MONTH_MS));
}

/** The Veteran tier a subscription that started then has reached: 12, 6, 3 or 0. */
export function veteranTier(startedAt: number, now: number): 0 | 3 | 6 | 12 {
  const months = monthsSubscribed(startedAt, now);
  return months >= 12 ? 12 : months >= 6 ? 6 : months >= 3 ? 3 : 0;
}

/** Whether removing this many of the role's members at once is too many to do without the owner looking. */
export function tooManyToRemove(removals: number, holders: number): boolean {
  return removals > Math.max(5, Math.floor(holders * 0.3));
}

/** Each member's live subscription (the longest-running one if there are several). */
export function liveSubscriptionsByMember(subscriptions: StripeSubscriptionInfo[]): Map<string, StripeSubscriptionInfo> {
  const live = new Map<string, StripeSubscriptionInfo>();
  for (const subscription of subscriptions) {
    if (!subscription.discordUserId || !(LIVE_STATUSES as readonly string[]).includes(subscription.status)) continue;
    const known = live.get(subscription.discordUserId);
    if (!known || subscription.startedAt < known.startedAt) live.set(subscription.discordUserId, subscription);
  }
  return live;
}

export interface AuditResult {
  holders: number;
  complete: boolean;
  toRemove: GuildMember[];
  removed: string[];
  held: boolean;
  veteransGiven: { id: string; tier: number }[];
  veteransTaken: number;
}

async function log(client: Client, title: string, description: string, tone: Tone): Promise<void> {
  if (!env.LOG_CHANNEL_ID) return;
  const channel = await fetchSendableChannel(client, env.LOG_CHANNEL_ID).catch(() => null);
  await channel?.send({ embeds: [tcpEmbed({ title, description, tone, timestamp: true })], allowedMentions: { parse: [] } }).catch(() => undefined);
}

async function veteranRoles(guild: Guild, create: boolean): Promise<Map<number, Role>> {
  const roles = new Map<number, Role>();
  for (const tier of VETERAN_TIERS) {
    let role = guild.roles.cache.find((r) => plainName(r.name) === plainName(tier.name)) ?? null;
    if (!role && create) {
      role = await guild.roles
        .create({ name: tier.name, colors: { primaryColor: tier.colour }, permissions: [], reason: 'T.C.P Veteran role' })
        .catch((error: unknown) => {
          logger.warn({ err: error }, `[TCP Audit] Could not create the ${tier.name} role; the bot needs Manage Roles`);
          return null;
        });
    }
    if (role && isSafeSelfRole(role)) roles.set(tier.months, role);
  }
  return roles;
}

/**
 * The check itself. With apply false it only works out who would lose the Elite role. With apply true it
 * removes it (unless that is too many at once and force is false) and sorts out the Veteran roles.
 */
export async function runEliteAudit(client: Client, options: { apply: boolean; force?: boolean }): Promise<AuditResult | null> {
  const guild = client.guilds.cache.get(env.DISCORD_GUILD_ID) ?? (await client.guilds.fetch(env.DISCORD_GUILD_ID));
  const role = eliteRole(guild);
  // Never remove anything on missing data: without the license records or Stripe the check does not run.
  if (!role || !licenceRecordsOpen()) return null;
  const subscriptions = await listStripeSubscriptions();
  if (!subscriptions) return null;
  const now = Date.now();
  const live = liveSubscriptionsByMember(subscriptions);
  const { members, complete } = await allMembers(guild);
  const everyone = [...members.values()].filter((member) => !member.user.bot);
  const holders = everyone.filter((member) => member.roles.cache.has(role.id));

  const toRemove: GuildMember[] = [];
  for (const member of holders) {
    if (isStaffMember(member) || live.has(member.id)) continue;
    let expiry: number | null;
    try {
      expiry = await licenceExpiry(member.id);
    } catch {
      return null;
    }
    if (expiry !== null && expiry > now) continue;
    toRemove.push(member);
  }
  const result: AuditResult = { holders: holders.length, complete, toRemove, removed: [], held: false, veteransGiven: [], veteransTaken: 0 };
  if (!options.apply) return result;

  if (toRemove.length > 0 && tooManyToRemove(toRemove.length, holders.length) && !options.force) {
    result.held = true;
  } else {
    for (const member of toRemove) {
      const done = await member.roles
        .remove(role, 'T.C.P daily check: no subscription or license days')
        .then(() => true)
        .catch(() => false);
      if (done) result.removed.push(member.id);
    }
  }

  // Veteran roles: only made once someone qualifies.
  const anyVeteran = [...live.values()].some((subscription) => veteranTier(subscription.startedAt, now) > 0);
  const tiers = await veteranRoles(guild, anyVeteran);
  if (tiers.size > 0) {
    const shoutouts = eliteWelcomeChannel(guild);
    for (const member of everyone) {
      const subscription = live.get(member.id);
      const tier = subscription ? veteranTier(subscription.startedAt, now) : 0;
      for (const [months, tierRole] of tiers) {
        const should = months === tier;
        const has = member.roles.cache.has(tierRole.id);
        if (should && !has) {
          const given = await member.roles.add(tierRole, 'T.C.P Veteran role').then(() => true).catch(() => false);
          if (!given) continue;
          result.veteransGiven.push({ id: member.id, tier: months });
          const label = VETERAN_TIERS.find((t) => t.months === months)!.label;
          await shoutouts
            ?.send({
              content: `<@${member.id}>`,
              embeds: [tcpEmbed({ title: `🎖️ ${tierRole.name}`, tone: 'success', thumbnail: member.displayAvatarURL(), description: `<@${member.id}> has supported T.C.P for **${label}** without a break. Thank you!` })],
              allowedMentions: { users: [member.id] },
            })
            .catch(() => undefined);
        } else if (!should && has) {
          const taken = await member.roles.remove(tierRole, 'T.C.P Veteran role: tier changed or subscription ended').then(() => true).catch(() => false);
          if (taken && tier === 0) result.veteransTaken += 1;
        }
      }
    }
  }
  return result;
}

function describe(result: AuditResult): string {
  return [
    `**${result.holders}** member${result.holders === 1 ? '' : 's'} hold the Elite role.`,
    result.removed.length > 0 ? `Removed it from ${result.removed.length}: ${result.removed.slice(0, 40).map((id) => `<@${id}>`).join(' ')}` : '',
    result.held
      ? `**Held back:** ${result.toRemove.length} members have no subscription or days, which is too many to remove at once. Run \`/tcp audit\` to see them and remove the role after a look.`
      : '',
    result.veteransGiven.length > 0 ? `New Veteran roles: ${result.veteransGiven.map((v) => `<@${v.id}> (${v.tier} months)`).join(', ')}` : '',
    result.veteransTaken > 0 ? `Veteran roles taken from ${result.veteransTaken} former subscriber${result.veteransTaken === 1 ? '' : 's'}.` : '',
    result.complete ? '' : 'The bot could not list every member (Server Members Intent off), so some were not checked.',
  ]
    .filter(Boolean)
    .join('\n');
}

export function startEliteAudit(client: Client): void {
  scheduleJob(
    'elite-audit',
    DAY_MS,
    async () => {
      // The very first run only reports, so the owner sees who would lose the role before anything is removed.
      if (!(await getState<boolean>('elite-audit.armed', false))) {
        const preview = await runEliteAudit(client, { apply: false });
        if (!preview) return;
        await setState('elite-audit.armed', true);
        await log(
          client,
          'Daily Elite check is on',
          [
            `**${preview.holders}** member${preview.holders === 1 ? '' : 's'} hold the Elite role.`,
            preview.toRemove.length === 0
              ? 'Everyone who holds it has a subscription, license days, or is on the team.'
              : `From tomorrow, the role is removed from members with no subscription and no license days. Right now that would be **${preview.toRemove.length}**: ${preview.toRemove.slice(0, 40).map((m) => `<@${m.id}>`).join(' ')}\nTo keep someone, give them days with **Add days** on the owner panel. \`/tcp audit\` shows the list any time.`,
            'Veteran roles (3 months, 6 months, 1 year without a break) start from tomorrow too.',
          ].join('\n'),
          'muted',
        );
        return;
      }
      const result = await runEliteAudit(client, { apply: true });
      if (!result) {
        logger.info('[TCP Audit] Skipped: no Elite role, no Stripe, or the license records are not readable');
        return;
      }
      logger.info(`[TCP Audit] ${result.holders} holders, ${result.removed.length} removed${result.held ? ' (held back)' : ''}, ${result.veteransGiven.length} Veteran roles given`);
      if (result.removed.length > 0 || result.held || result.veteransGiven.length > 0 || result.veteransTaken > 0) {
        await log(client, 'Daily Elite check', describe(result), result.held ? 'warning' : 'success');
      }
    },
    { firstCheckMs: 5 * 60 * 1000 },
  );
}

/** /tcp audit: the owner sees who would lose the Elite role, with a button to remove it. */
export async function handleAuditCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!env.OWNER_USER_ID || interaction.user.id !== env.OWNER_USER_ID) {
    await interaction.reply({ ...notice('Only the owner can use this command.', { tone: 'danger' }), ephemeral: true });
    return;
  }
  await interaction.deferReply({ ephemeral: true });
  const result = await runEliteAudit(interaction.client, { apply: false });
  if (!result) {
    await interaction.editReply(notice('The check could not run: no Elite role, Stripe is not set up, or the license records are not open.', { tone: 'warning' }));
    return;
  }
  const lines = [
    `**${result.holders}** member${result.holders === 1 ? '' : 's'} hold the Elite role.`,
    result.toRemove.length === 0
      ? 'Everyone who holds it has a subscription, license days, or is on the team. Nothing to remove.'
      : `**${result.toRemove.length}** have no subscription and no license days:\n${result.toRemove.slice(0, 50).map((m) => `<@${m.id}>`).join(' ')}${result.toRemove.length > 50 ? ` and ${result.toRemove.length - 50} more` : ''}`,
    result.complete ? '' : 'The bot could not list every member (Server Members Intent off).',
  ].filter(Boolean);
  await interaction.editReply({
    ...notice(lines.join('\n\n'), { title: 'Elite role check' }),
    components:
      result.toRemove.length > 0
        ? [new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(APPLY_ID).setLabel(`Remove the role from ${result.toRemove.length}`).setStyle(ButtonStyle.Danger))]
        : [],
    allowedMentions: { parse: [] },
  });
}

export async function handleAuditInteraction(interaction: Interaction): Promise<boolean> {
  if (!interaction.isButton() || interaction.customId !== APPLY_ID) return false;
  if (!env.OWNER_USER_ID || interaction.user.id !== env.OWNER_USER_ID) {
    await interaction.reply({ ...notice('Only the owner can do that.', { tone: 'danger' }), ephemeral: true });
    return true;
  }
  await interaction.update({ ...notice('Removing the role...', { tone: 'muted' }), components: [] });
  const result = await runEliteAudit(interaction.client, { apply: true, force: true });
  await interaction.editReply({ ...notice(result ? describe(result) || 'Done.' : 'The check could not run.', { title: 'Elite role check', tone: 'success' }), allowedMentions: { parse: [] } });
  return true;
}
