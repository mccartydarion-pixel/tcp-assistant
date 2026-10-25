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
import { createPremiumStore, type MarkRecord, type PremiumFile, type PremiumStore } from './premiumStore.js';
import { definesIn, markFits, newMark, stampCopy } from './fingerprint.js';

// T.C.P Premium for paying members. On a member's first payment the bot DMs them the premium script
// (Premium/T.C.P Premium.gpc), gives them the Elite Supporter role and welcomes them in the
// elite welcome channel. Renewals keep the role; when the subscription ends the role is taken away.
// The owner uploads the script with /tcp release; it is kept in the database, never in the bot's public
// repository, and only the scrambled release is accepted (the readable one carries the licence key).
// Subscribers can fetch the latest upload any time with Download Premium. Every copy sent out carries the
// member's own fingerprint (see fingerprint.ts), and /tcp trace tells the owner whose a leaked copy was.
// Only Elite Supporters (and the owner) can generate unlock codes.
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
  if (!/\.gpc$/i.test(fileName)) return { ok: false, reason: 'That is not a .gpc file. Upload **T.C.P Premium.gpc** (in the Premium folder).' };
  if (/LICENSE_KEY|license_(update|guard|match|ok)|\btcp_frame\b/i.test(text)) {
    return {
      ok: false,
      reason:
        'That file is readable, not scrambled. The readable release has your real license key in it and must never be given out. Upload the scrambled **T.C.P Premium.gpc** (in the Premium folder) (built with `--license --scramble`).',
    };
  }
  const scrambledDefines = text.match(/^define z[0-9a-f]+\s*=/gm)?.length ?? 0;
  if (scrambledDefines < 50) {
    return { ok: false, reason: 'That does not look like the scrambled T.C.P release. Upload **T.C.P Premium.gpc** (in the Premium folder) (built with `--license --scramble`).' };
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

/** True when this member holds the Elite role. False when the role is not set up or they are not in the server. */
export async function isEliteMember(client: Client, discordUserId: string): Promise<boolean> {
  try {
    const guild = client.guilds.cache.get(env.DISCORD_GUILD_ID) ?? (await client.guilds.fetch(env.DISCORD_GUILD_ID));
    const role = eliteRole(guild);
    if (!role) return false;
    const member = await guild.members.fetch(discordUserId).catch(() => null);
    return member?.roles.cache.has(role.id) ?? false;
  } catch (error) {
    logger.warn({ err: error }, `[TCP Premium] Could not check the Elite role of ${discordUserId}`);
    return false;
  }
}

/** The name of the Elite role, for messages; "Elite Supporter" when it is not found. */
export function eliteRoleName(client: Client): string {
  const guild = client.guilds.cache.get(env.DISCORD_GUILD_ID);
  return (guild && eliteRole(guild)?.name) || 'Elite Supporter';
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
          '**Your Premium script is in your DMs.** No DM? Press **Download Premium** on the license panel.',
          licenceChannelId ? `Need a code for your Zen? Press **Generate** in <#${licenceChannelId}>.` : 'Need a code for your Zen? Press **Generate** on the license panel.',
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
            : '`3` Get your code with **Generate** on the license panel and enter it on the Zen.',
          '',
          'Keep this file to yourself: it only unlocks with your own code, and every copy is personal to the member it was sent to. When a new version comes out, press **Download Premium** on the license panel.',
        ].join('\n'),
      }),
    ],
    files: [new AttachmentBuilder(file.content, { name: file.fileName })],
  };
}

// ---- fingerprinted copies --------------------------------------------------------------------------

/** This member's own copy of the current upload, with their fingerprint in it. */
async function personalCopy(discordUserId: string): Promise<{ fileName: string; content: Buffer }> {
  if (!current || !store) throw new Error('No premium script uploaded');
  const file = current;
  const text = file.content.toString('utf8');
  let mark = await store.getMark(discordUserId, file.sha256);
  for (let attempt = 0; !mark && attempt < 5; attempt += 1) {
    const handedOut = await store.listMarks();
    const fresh = newMark(text, (candidate) => handedOut.some((m) => m.name === candidate.name && m.value === candidate.value));
    mark = await store.claimMark(discordUserId, file.sha256, fresh);
  }
  if (!mark || !markFits(text, mark)) throw new Error(`Could not give ${discordUserId} a fingerprint`);
  return { fileName: file.fileName, content: Buffer.from(stampCopy(text, mark), 'utf8') };
}

/** Whose copies a file came from: every member whose fingerprint is in it. */
export function findOwners(text: string, marks: MarkRecord[]): MarkRecord[] {
  const defines = new Set(definesIn(text).map((define) => `${define.name}=${define.value}`));
  return marks.filter((mark) => defines.has(`${mark.name}=${mark.value}`));
}

// ---- payment hooks ---------------------------------------------------------------------------------

/**
 * A payment went through. Every payment makes sure the member has the Elite role; the first one also DMs
 * them the script and welcomes them in the elite welcome channel. Never throws: the payment is already
 * recorded, and a retry must not add days twice.
 */
export async function onPremiumPaid(client: Client, discordUserId: string, first: boolean): Promise<void> {
  await welcomeElite(client, discordUserId, first);
}

/** What a welcome did, for /tcp sync. */
interface WelcomeResult {
  inServer: boolean;
  hasRole: boolean;
  scriptSent: boolean;
  welcomePosted: boolean;
}

async function welcomeElite(client: Client, discordUserId: string, first: boolean): Promise<WelcomeResult> {
  const result: WelcomeResult = { inServer: false, hasRole: false, scriptSent: false, welcomePosted: false };
  try {
    const guild = client.guilds.cache.get(env.DISCORD_GUILD_ID) ?? (await client.guilds.fetch(env.DISCORD_GUILD_ID));
    const member = await guild.members.fetch(discordUserId).catch(() => null);
    result.inServer = member !== null;
    const role = eliteRole(guild);
    if (member && role && !member.roles.cache.has(role.id)) {
      await member.roles.add(role, 'T.C.P Premium payment').catch((error: unknown) =>
        logger.warn({ err: error }, `[TCP Premium] Could not give ${role.name}; check Manage Roles and that the bot's role sits above it.`),
      );
    }
    result.hasRole = Boolean(member && role && member.roles.cache.has(role.id));
    if (!first) return result;

    let delivered = false;
    if (current) {
      try {
        const user = member?.user ?? (await client.users.fetch(discordUserId));
        await user.send(premiumFileMessage(await personalCopy(discordUserId), env.LICENSE_CHANNEL_ID));
        delivered = true;
        result.scriptSent = true;
      } catch (error) {
        logger.info({ err: error }, `[TCP Premium] Could not DM the script to ${discordUserId}`);
      }
    }
    if (!delivered) {
      await ownerLog(
        client,
        'Premium script not delivered',
        current
          ? `<@${discordUserId}> has DMs closed, so the script could not be sent. They can press **Download Premium** on the license panel.`
          : `<@${discordUserId}> paid, but no script is uploaded yet. Upload it with \`/tcp release\`; they can then press **Download Premium**.`,
        'warning',
      );
    }

    const channel = eliteWelcomeChannel(guild);
    if (channel && member) {
      result.welcomePosted = await channel
        .send(eliteWelcomeMessage({ id: member.id, displayName: member.displayName, avatarURL: member.displayAvatarURL() }, role?.name ?? null, env.LICENSE_CHANNEL_ID))
        .then(() => true)
        .catch((error: unknown) => {
          logger.warn({ err: error }, '[TCP Premium] Could not post in the elite welcome channel');
          return false;
        });
    }
    logger.info(`[TCP Premium] Welcomed ${discordUserId} (script ${delivered ? 'sent' : 'not sent'}, role ${role ? 'given' : 'not found'})`);
  } catch (error) {
    logger.error({ err: error }, `[TCP Premium ERROR] Could not finish welcoming ${discordUserId}`);
  }
  return result;
}

/**
 * /tcp sync: the owner runs the first-payment welcome again for a member (themselves by default): the Elite
 * role, the script by DM and the post in the elite welcome channel. For members who paid before the welcome
 * existed, or whose DM or role failed. Other members need a live subscription.
 */
export async function handleSyncCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!env.OWNER_USER_ID || interaction.user.id !== env.OWNER_USER_ID) {
    await interaction.reply({ ...notice('Only the owner can use this command.', { tone: 'danger' }), ephemeral: true });
    return;
  }
  await interaction.deferReply({ ephemeral: true });
  const target = interaction.options.getUser('member') ?? interaction.user;
  if (target.id !== interaction.user.id && !(await isSubscriber(target.id))) {
    await interaction.editReply(
      notice(`<@${target.id}> has no live T.C.P Premium subscription, so they were not welcomed. To give access by hand, use **Add days** on the owner panel.`, {
        title: 'Not synced',
        tone: 'warning',
      }),
    );
    return;
  }
  const result = await welcomeElite(interaction.client, target.id, true);
  const role = eliteRoleName(interaction.client);
  const lines = [
    result.inServer ? (result.hasRole ? `✅ Has the **${role}** role.` : `❌ Could not give the **${role}** role: check Manage Roles and that the bot's role sits above it.`) : '❌ Not in the server.',
    result.scriptSent ? '✅ Premium script sent by DM.' : current ? '❌ Script not sent: their DMs are closed. They can press **Download Premium**.' : '❌ Script not sent: none uploaded yet (`/tcp release`).',
    result.welcomePosted ? '✅ Welcome posted in the elite welcome channel.' : '❌ No welcome posted: the elite welcome channel was not found, or the bot cannot post there.',
  ];
  await interaction.editReply({ ...notice(lines.join('\n'), { title: `Synced ${target.username}`, tone: 'success' }), allowedMentions: { parse: [] } });
}

/** The subscription ended: take the Elite role away. Their licence days still run out as normal. */
export async function onPremiumEnded(client: Client, discordUserId: string): Promise<void> {
  await setEliteRole(client, discordUserId, false, 'T.C.P Premium subscription ended');
}

/**
 * Gives (on) or takes away (off) the Elite role, for payments and the owner's Add days / End access.
 * True when the member ends up as asked. Never throws.
 */
export async function setEliteRole(client: Client, discordUserId: string, on: boolean, reason: string): Promise<boolean> {
  try {
    const guild = client.guilds.cache.get(env.DISCORD_GUILD_ID) ?? (await client.guilds.fetch(env.DISCORD_GUILD_ID));
    const role = eliteRole(guild);
    const member = await guild.members.fetch(discordUserId).catch(() => null);
    if (!role || !member) return false;
    if (on && !member.roles.cache.has(role.id)) await member.roles.add(role, reason);
    if (!on && member.roles.cache.has(role.id)) await member.roles.remove(role, reason);
    return true;
  } catch (error) {
    logger.warn({ err: error }, `[TCP Premium] Could not ${on ? 'give' : 'take'} the Elite role ${on ? 'to' : 'from'} ${discordUserId}; check Manage Roles and that the bot's role sits above it.`);
    return false;
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
  const allowed = owner || (await isEliteMember(interaction.client, interaction.user.id)) || (await isSubscriber(interaction.user.id));
  if (!allowed) {
    await interaction.editReply(
      notice(`Download Premium is for **${eliteRoleName(interaction.client)}s**. Press **Subscribe** on the license panel to join.`, { tone: 'muted' }),
    );
    return true;
  }
  if (!current) {
    await interaction.editReply(notice('The Premium script has not been uploaded yet. The owner has been told; please check back soon.', { tone: 'warning' }));
    await ownerLog(interaction.client, 'Premium script missing', `<@${interaction.user.id}> pressed Download Premium, but no script is uploaded. Use \`/tcp release\`.`, 'warning');
    return true;
  }
  let copy;
  try {
    copy = await personalCopy(interaction.user.id);
  } catch (error) {
    logger.error({ err: error }, `[TCP Premium ERROR] Could not prepare a copy for ${interaction.user.id}`);
    await interaction.editReply(notice('Your copy could not be prepared just now. Please try again in a minute.', { tone: 'danger' }));
    return true;
  }
  await interaction.editReply(premiumFileMessage(copy, env.LICENSE_CHANNEL_ID));
  logger.info(`[TCP Premium] ${interaction.user.id} downloaded ${current.fileName}`);
  return true;
}

/** /tcp trace: the owner attaches a copy found somewhere, and the bot says whose it was. */
export async function handleTraceCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!env.OWNER_USER_ID || interaction.user.id !== env.OWNER_USER_ID) {
    await interaction.reply({ ...notice('Only the owner can use this command.', { tone: 'danger' }), ephemeral: true });
    return;
  }
  await interaction.deferReply({ ephemeral: true });
  if (!store) {
    await interaction.editReply(notice('The premium file records are not open. Check the bot log.', { tone: 'danger' }));
    return;
  }
  const attachment = interaction.options.getAttachment('file', true);
  if (attachment.size > MAX_FILE_BYTES) {
    await interaction.editReply(notice('That file is too big for a T.C.P script.', { tone: 'warning' }));
    return;
  }
  const response = await fetch(attachment.url);
  if (!response.ok) {
    await interaction.editReply(notice('Could not read the file from Discord. Please try again.', { tone: 'danger' }));
    return;
  }
  const content = Buffer.from(await response.arrayBuffer());
  const owners = findOwners(content.toString('utf8'), await store.listMarks());
  if (owners.length === 0) {
    const yours = current !== null && createHash('sha256').update(content).digest('hex') === current.sha256;
    await interaction.editReply(
      notice(
        yours
          ? "This is your own upload, exactly as you sent it to `/tcp release`. It carries no member's fingerprint."
          : 'No fingerprint found. Either this copy was handed out before fingerprints began (16 October 2026), it is not the Premium script, or someone found and removed the line.',
        { title: 'Trace', tone: yours ? 'muted' : 'warning' },
      ),
    );
    return;
  }
  const lines = owners.map((mark) => {
    const version = current && mark.fileSha === current.sha256 ? 'the current upload' : `an older upload (\`${mark.fileSha.slice(0, 12)}\`)`;
    return `• <@${mark.discordUserId}> (\`${mark.discordUserId}\`): their copy of ${version}, first sent <t:${Math.floor(mark.createdAt / 1000)}:R>.`;
  });
  if (owners.length > 1) lines.push('', "More than one fingerprint: this copy was put together from several members' copies.");
  await interaction.editReply({
    ...notice(lines.join('\n'), { title: owners.length === 1 ? 'This copy belongs to' : 'This copy carries fingerprints of', tone: 'danger' }),
    allowedMentions: { parse: [] },
  });
  logger.info(`[TCP Premium] Owner traced a copy to ${owners.map((mark) => mark.discordUserId).join(', ')}`);
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
        : notice('No premium script uploaded yet. Run `/tcp release` and attach **T.C.P Premium.gpc** (in the Premium folder).', { title: 'Premium script', tone: 'warning' }),
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
  if (first) await onUploaded().catch((error: unknown) => logger.warn({ err: error }, '[TCP Premium] Could not refresh the license panel'));
  logger.info(`[TCP Premium] Owner uploaded ${file.fileName} (${content.length} bytes, ${file.sha256.slice(0, 12)})`);
  await interaction.editReply(
    notice(
      `**${file.fileName}** is now the Premium script (${content.length.toLocaleString('en-US')} bytes, fingerprint \`${file.sha256.slice(0, 12)}\`).\nNew subscribers get it in their DMs, and everyone subscribed can get it with **Download Premium**.`,
      { title: 'Premium script saved', tone: 'success' },
    ),
  );
}
