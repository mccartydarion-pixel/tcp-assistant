import { createHash } from 'node:crypto';
import {
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  type ChatInputCommandInteraction,
  type Client,
  type Guild,
  type Interaction,
  type Role,
  type TextChannel,
} from 'discord.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { fetchSendableChannel } from '../bot/panels.js';
import { notice, tcpEmbed, type Tone } from '../bot/embeds.js';
import { isSafeSelfRole, plainName } from '../bot/roles.js';
import { createPremiumStore, type PremiumFile, type PremiumStore } from './premiumStore.js';

// T.C.P Premium for paying members. On a member's first payment the bot DMs them the premium script
// (Tactical Competitive Pro Release.gpc), gives them the Elite Supporter role and welcomes them in the
// elite welcome channel. Renewals keep the role; when the subscription ends the role is taken away.
// The owner uploads the script with /tcp release; it is kept in the database, never in the bot's public
// repository, and only the scrambled release is accepted (the readable one carries the licence key).
// Subscribers can fetch the latest upload any time with Download Premium.
const PREFIX = 'tcp-premium:';
export const PREMIUM_DOWNLOAD_ID = `${PREFIX}download`;
const MAX_FILE_BYTES = 2_000_000;

let store: PremiumStore | null = null;
let current: PremiumFile | null = null;
let isSubscriber: (discordUserId: string) => Promise<boolean> = async () => false;
let onUploaded: () => Promise<void> = async () => {};

// ---- the release file ------------------------------------------------------------------------------

/**
 * Whether an upload is the scrambled release, safe to give out. The readable release has the real licence
 * key and every real name in it; the debug, play and free builds are readable too. The scrambled release has
 * only z-names.
 */
export function checkRelease(fileName: string, text: string): { ok: true } | { ok: false; reason: string } {
  if (!/\.gpc$/i.test(fileName)) return { ok: false, reason: 'That is not a .gpc file. Upload **Tactical Competitive Pro Release.gpc**.' };
  if (/LICENSE_KEY|license_(update|guard|match|ok)|\btcp_frame\b/i.test(text)) {
    return {
      ok: false,
      reason:
        'That file is readable, not scrambled. The readable release has your real licence key in it and must never be given out. Upload the scrambled **Tactical Competitive Pro Release.gpc** (built with `--license --scramble`).',
    };
  }
  const scrambledDefines = text.match(/^define z[0-9a-f]+\s*=/gm)?.length ?? 0;
  if (scrambledDefines < 50) {
    return { ok: false, reason: 'That does not look like the scrambled T.C.P release. Upload **Tactical Competitive Pro Release.gpc** (built with `--license --scramble`).' };
  }
  return { ok: true };
}

export function premiumAvailable(): boolean {
  return current !== null;
}

export async function initPremium(
  client: Client,
  deps: { isSubscriber: (discordUserId: string) => Promise<boolean>; onUploaded?: () => Promise<void> },
): Promise<void> {
  isSubscriber = deps.isSubscriber;
  if (deps.onUploaded) onUploaded = deps.onUploaded;
  try {
    const opened = createPremiumStore();
    await opened.init();
    store = opened;
    current = await opened.get();
    logger.info(
      current
        ? `[TCP Premium] Script ready: ${current.fileName} (${current.content.length} bytes, uploaded ${new Date(current.uploadedAt).toISOString()})`
        : '[TCP Premium] No premium script uploaded yet; the owner uploads it with /tcp release.',
    );
  } catch (error) {
    logger.error({ err: error }, '[TCP Premium ERROR] Could not open the premium file records.');
  }
  const guild = client.guilds.cache.get(env.DISCORD_GUILD_ID);
  if (guild) {
    const role = eliteRole(guild);
    const channel = eliteWelcomeChannel(guild);
    logger.info(`[TCP Premium] Elite role: ${role ? role.name : 'not found'}; elite welcome channel: ${channel ? `#${channel.name}` : 'not found'}.`);
  }
}

// ---- role and welcome channel ----------------------------------------------------------------------

export function isEliteRoleName(name: string): boolean {
  return plainName(name).includes('elitesupporter');
}

export function isEliteWelcomeName(name: string): boolean {
  const plain = plainName(name);
  return plain.includes('elite') && plain.includes('welcome');
}

/** ELITE_ROLE_ID, else a role called "Elite Supporter". Never one with moderator powers. */
function eliteRole(guild: Guild): Role | null {
  const role = env.ELITE_ROLE_ID ? guild.roles.cache.get(env.ELITE_ROLE_ID) : guild.roles.cache.find((r) => isEliteRoleName(r.name));
  if (!role) return null;
  if (!isSafeSelfRole(role)) {
    logger.warn(`[TCP Premium] The ${role.name} role has moderator permissions, so the bot will not hand it out.`);
    return null;
  }
  return role;
}

/** ELITE_WELCOME_CHANNEL_ID, else a text channel with "elite" and "welcome" in its name. */
function eliteWelcomeChannel(guild: Guild): TextChannel | null {
  const channel = env.ELITE_WELCOME_CHANNEL_ID
    ? guild.channels.cache.get(env.ELITE_WELCOME_CHANNEL_ID)
    : guild.channels.cache.find((c) => c.type === ChannelType.GuildText && isEliteWelcomeName(c.name));
  return channel && channel.type === ChannelType.GuildText ? channel : null;
}

async function ownerLog(client: Client, title: string, description: string, tone: Tone): Promise<void> {
  if (!env.LOG_CHANNEL_ID) return;
  try {
    const channel = await fetchSendableChannel(client, env.LOG_CHANNEL_ID);
    if (channel) await channel.send({ embeds: [tcpEmbed({ title, description, tone, timestamp: true })], allowedMentions: { parse: [] } });
  } catch (error) {
    logger.warn({ err: error }, '[TCP Premium] Could not write to the log channel');
  }
}

export function eliteWelcomeMessage(member: { id: string; displayName: string; avatarURL: string }, roleName: string | null, licenceChannelId?: string) {
  return {
    content: `<@${member.id}>`,
    embeds: [
      tcpEmbed({
        title: `Welcome to the Elite, ${member.displayName}!`,
        thumbnail: member.avatarURL,
        tone: 'success',
        description: [
          `Thanks for supporting T.C.P.${roleName ? ` You're now an **${roleName}**.` : ''}`,
          '',
          '**Your Premium script is in your DMs.** No DM? Press **Download Premium** on the licence panel.',
          licenceChannelId ? `Need a code for your Zen? Press **Generate** in <#${licenceChannelId}>.` : 'Need a code for your Zen? Press **Generate** on the licence panel.',
        ].join('\n'),
      }),
    ],
    allowedMentions: { users: [member.id] },
  };
}

export function premiumFileMessage(file: Pick<PremiumFile, 'fileName' | 'content'>, licenceChannelId?: string) {
  return {
    embeds: [
      tcpEmbed({
        title: 'Your T.C.P Premium script',
        tone: 'success',
        description: [
          '`1` Add the attached file to Zen Studio and program it to a slot on your Cronus Zen.',
          '`2` Load that slot. On the lock screen press **X** (**A** on Xbox) to see your number.',
          licenceChannelId
            ? `\`3\` Get your code with **Generate** in <#${licenceChannelId}> and enter it on the Zen.`
            : '`3` Get your code with **Generate** on the licence panel and enter it on the Zen.',
          '',
          'Keep this file to yourself: it only unlocks with your own code. When a new version comes out, press **Download Premium** on the licence panel.',
        ].join('\n'),
      }),
    ],
    files: [new AttachmentBuilder(file.content, { name: file.fileName })],
  };
}

// ---- payment hooks ---------------------------------------------------------------------------------

/**
 * A payment went through. Every payment makes sure the member has the Elite role; the first one also DMs
 * them the script and welcomes them in the elite welcome channel. Never throws: the payment is already
 * recorded, and a retry must not add days twice.
 */
export async function onPremiumPaid(client: Client, discordUserId: string, first: boolean): Promise<void> {
  try {
    const guild = client.guilds.cache.get(env.DISCORD_GUILD_ID) ?? (await client.guilds.fetch(env.DISCORD_GUILD_ID));
    const member = await guild.members.fetch(discordUserId).catch(() => null);
    const role = eliteRole(guild);
    if (member && role && !member.roles.cache.has(role.id)) {
      await member.roles.add(role, 'T.C.P Premium payment').catch((error: unknown) =>
        logger.warn({ err: error }, `[TCP Premium] Could not give ${role.name}; check Manage Roles and that the bot's role sits above it.`),
      );
    }
    if (!first) return;

    let delivered = false;
    if (current) {
      try {
        const user = member?.user ?? (await client.users.fetch(discordUserId));
        await user.send(premiumFileMessage(current, env.LICENSE_CHANNEL_ID));
        delivered = true;
      } catch (error) {
        logger.info({ err: error }, `[TCP Premium] Could not DM the script to ${discordUserId}`);
      }
    }
    if (!delivered) {
      await ownerLog(
        client,
        'Premium script not delivered',
        current
          ? `<@${discordUserId}> has DMs closed, so the script could not be sent. They can press **Download Premium** on the licence panel.`
          : `<@${discordUserId}> paid, but no script is uploaded yet. Upload it with \`/tcp release\`; they can then press **Download Premium**.`,
        'warning',
      );
    }

    const channel = eliteWelcomeChannel(guild);
    if (channel && member) {
      await channel
        .send(eliteWelcomeMessage({ id: member.id, displayName: member.displayName, avatarURL: member.displayAvatarURL() }, role?.name ?? null, env.LICENSE_CHANNEL_ID))
        .catch((error: unknown) => logger.warn({ err: error }, '[TCP Premium] Could not post in the elite welcome channel'));
    }
    logger.info(`[TCP Premium] Welcomed ${discordUserId} (script ${delivered ? 'sent' : 'not sent'}, role ${role ? 'given' : 'not found'})`);
  } catch (error) {
    logger.error({ err: error }, `[TCP Premium ERROR] Could not finish welcoming ${discordUserId}`);
  }
}

/** The subscription ended: take the Elite role away. Their licence days still run out as normal. */
export async function onPremiumEnded(client: Client, discordUserId: string): Promise<void> {
  try {
    const guild = client.guilds.cache.get(env.DISCORD_GUILD_ID) ?? (await client.guilds.fetch(env.DISCORD_GUILD_ID));
    const role = eliteRole(guild);
    const member = await guild.members.fetch(discordUserId).catch(() => null);
    if (role && member?.roles.cache.has(role.id)) await member.roles.remove(role, 'T.C.P Premium subscription ended');
  } catch (error) {
    logger.warn({ err: error }, `[TCP Premium] Could not take the Elite role from ${discordUserId}`);
  }
}

// ---- download button and /tcp release ---------------------------------------------------------------

export function premiumDownloadButton(): ButtonBuilder {
  return new ButtonBuilder().setCustomId(PREMIUM_DOWNLOAD_ID).setLabel('Download Premium').setStyle(ButtonStyle.Success);
}

export async function handlePremiumInteraction(interaction: Interaction): Promise<boolean> {
  if (!interaction.isButton() || interaction.customId !== PREMIUM_DOWNLOAD_ID) return false;
  await interaction.deferReply({ ephemeral: true });
  const owner = Boolean(env.OWNER_USER_ID) && interaction.user.id === env.OWNER_USER_ID;
  if (!owner && !(await isSubscriber(interaction.user.id))) {
    await interaction.editReply(notice('Download Premium is for T.C.P Premium subscribers. Press **Subscribe** on the licence panel to join.', { tone: 'muted' }));
    return true;
  }
  if (!current) {
    await interaction.editReply(notice('The Premium script has not been uploaded yet. The owner has been told; please check back soon.', { tone: 'warning' }));
    await ownerLog(interaction.client, 'Premium script missing', `<@${interaction.user.id}> pressed Download Premium, but no script is uploaded. Use \`/tcp release\`.`, 'warning');
    return true;
  }
  await interaction.editReply(premiumFileMessage(current, env.LICENSE_CHANNEL_ID));
  logger.info(`[TCP Premium] ${interaction.user.id} downloaded ${current.fileName}`);
  return true;
}

/** /tcp release: the owner uploads the premium script (or, without a file, sees which one is live). */
export async function handleReleaseCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!env.OWNER_USER_ID || interaction.user.id !== env.OWNER_USER_ID) {
    await interaction.reply({ ...notice('Only the owner can use this command.', { tone: 'danger' }), ephemeral: true });
    return;
  }
  await interaction.deferReply({ ephemeral: true });
  if (!store) {
    await interaction.editReply(notice('The premium file records are not open. Check the bot log.', { tone: 'danger' }));
    return;
  }
  const attachment = interaction.options.getAttachment('file');
  if (!attachment) {
    await interaction.editReply(
      current
        ? notice(
            `**${current.fileName}**, ${current.content.length.toLocaleString('en-US')} bytes, uploaded <t:${Math.floor(current.uploadedAt / 1000)}:R> (fingerprint \`${current.sha256.slice(0, 12)}\`).\nTo replace it, run \`/tcp release\` again with the new file attached.`,
            { title: 'Premium script', tone: 'success' },
          )
        : notice('No premium script uploaded yet. Run `/tcp release` and attach **Tactical Competitive Pro Release.gpc**.', { title: 'Premium script', tone: 'warning' }),
    );
    return;
  }
  if (attachment.size > MAX_FILE_BYTES) {
    await interaction.editReply(notice('That file is too big for a T.C.P script.', { tone: 'warning' }));
    return;
  }
  const response = await fetch(attachment.url);
  if (!response.ok) {
    await interaction.editReply(notice('Could not read the uploaded file from Discord. Please try again.', { tone: 'danger' }));
    return;
  }
  const content = Buffer.from(await response.arrayBuffer());
  const check = checkRelease(attachment.name, content.toString('utf8'));
  if (!check.ok) {
    await interaction.editReply(notice(check.reason, { title: 'Not saved', tone: 'danger' }));
    return;
  }
  const file: PremiumFile = {
    fileName: attachment.name,
    content,
    sha256: createHash('sha256').update(content).digest('hex'),
    uploadedAt: Date.now(),
    uploadedBy: interaction.user.id,
  };
  const first = current === null;
  await store.save(file);
  current = file;
  // The first upload adds Download Premium to the licence panel.
  if (first) await onUploaded().catch((error: unknown) => logger.warn({ err: error }, '[TCP Premium] Could not refresh the licence panel'));
  logger.info(`[TCP Premium] Owner uploaded ${file.fileName} (${content.length} bytes, ${file.sha256.slice(0, 12)})`);
  await interaction.editReply(
    notice(
      `**${file.fileName}** is now the Premium script (${content.length.toLocaleString('en-US')} bytes, fingerprint \`${file.sha256.slice(0, 12)}\`).\nNew subscribers get it in their DMs, and everyone subscribed can get it with **Download Premium**.`,
      { title: 'Premium script saved', tone: 'success' },
    ),
  );
}
