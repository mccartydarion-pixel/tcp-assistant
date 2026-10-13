import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  type APIEmbedField,
  type Client,
  type Interaction,
} from 'discord.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { ensurePanel, fetchSendableChannel, repostPanel } from '../bot/panels.js';

// Settings sharing, as a short wizard in one private message that updates as the member goes:
//   1. playstyle and weapon (dropdowns)   2. recoil form   3. optional ADS form   then a preview and Post.
// The posted card is a stat sheet with a "How to apply" button that tells anyone which menu page each
// value goes on. Values are checked against the script's own ranges.
const PREFIX = 'tcp-settings:';
export const SETTINGS_BUTTON_ID = `${PREFIX}share`;
const STYLE_SELECT_ID = `${PREFIX}style`;
const WEAPON_SELECT_ID = `${PREFIX}weapon`;
const NEXT_ID = `${PREFIX}next`;
const EDIT_RECOIL_ID = `${PREFIX}edit-recoil`;
const ADD_ADS_ID = `${PREFIX}add-ads`;
const POST_ID = `${PREFIX}post`;
const CANCEL_ID = `${PREFIX}cancel`;
export const APPLY_ID = `${PREFIX}apply`;
const RECOIL_MODAL_ID = `${PREFIX}m-recoil`;
const ADS_MODAL_ID = `${PREFIX}m-ads`;

const SETTINGS_COLOUR = 0xe8352b;
export const SHARE_COOLDOWN_MS = 10 * 60 * 1000;
const DRAFT_LIFETIME_MS = 20 * 60 * 1000;

export const PLAYSTYLES = ['Close range', 'Mid range', 'Long range', 'All-round'] as const;
export const WEAPONS = ['Assault rifle', 'SMG', 'DMR', 'Sniper', 'Shotgun', 'Pistol', 'Any gun'] as const;

// One entry per number a member can share: the card's field name, the menu page it lives on (as shown on
// the Zen, 1-based), and the range the script accepts.
export const SETTING_FIELDS = {
  vertical: { name: 'Vertical', page: 10, menu: 'Vertical Recoil', min: 0, max: 100 },
  horizontal: { name: 'Horizontal', page: 11, menu: 'Horizontal Recoil', min: -50, max: 50 },
  turn: { name: 'Turn Strength', page: 12, menu: 'Turn Strength', min: 0, max: 100 },
  adsSens: { name: 'ADS Sens', page: 18, menu: 'ADS Sens', min: 0, max: 100 },
  fireSens: { name: 'Fire Sens', page: 20, menu: 'Fire Sens', min: 20, max: 100 },
  precision: { name: 'Precision', page: 21, menu: 'Precision', min: 0, max: 100 },
  easing: { name: 'Easing', page: 23, menu: 'Easing', min: 0, max: 100 },
} as const;
type SettingKey = keyof typeof SETTING_FIELDS;
const RECOIL_KEYS: SettingKey[] = ['vertical', 'horizontal', 'turn'];
const ADS_KEYS: SettingKey[] = ['adsSens', 'precision', 'easing', 'fireSens'];

export interface SettingsDraft {
  playstyle?: string;
  weapon?: string;
  name: string;
  inGame: string;
  notes: string;
  values: Partial<Record<SettingKey, number>>;
  /** The raw text typed into each form box, kept so a form reopens with what was typed. */
  typed: Record<string, string>;
  hasAds: boolean;
  createdAt: number;
}

const drafts = new Map<string, SettingsDraft>();
const lastShare = new Map<string, number>();

function newDraft(now: number): SettingsDraft {
  return { name: '', inGame: '', notes: '', values: {}, typed: {}, hasAds: false, createdAt: now };
}

/** A whole number within the setting's range. Blank is allowed for optional boxes. */
export function parseSettingValue(key: SettingKey, raw: string, required: boolean): { value?: number } | { error: string } {
  const field = SETTING_FIELDS[key];
  const text = raw.trim();
  if (!text) return required ? { error: `${field.name} is needed.` } : {};
  if (!/^[+-]?\d{1,3}$/.test(text)) return { error: `${field.name} must be a whole number, like ${field.min < 0 ? '-3 or 5' : '26'}.` };
  const value = Number(text);
  if (value < field.min || value > field.max) return { error: `${field.name} must be between ${field.min} and ${field.max}.` };
  return { value };
}

/** Reads the recoil form. Name, Vertical and the in-game sensitivity are required. */
export function readRecoilForm(form: { name: string; vertical: string; horizontal: string; turn: string; inGame: string }):
  | { name: string; inGame: string; values: Partial<Record<SettingKey, number>> }
  | { error: string } {
  const name = form.name.trim();
  const inGame = form.inGame.trim();
  if (!name) return { error: 'Give your setup a name, for example "Long range M4".' };
  if (!inGame) return { error: 'Add your DayZ in-game aiming sensitivity. The values only work with it.' };
  const values: Partial<Record<SettingKey, number>> = {};
  for (const [key, raw, required] of [
    ['vertical', form.vertical, true],
    ['horizontal', form.horizontal, false],
    ['turn', form.turn, false],
  ] as const) {
    const parsed = parseSettingValue(key, raw, required);
    if ('error' in parsed) return parsed;
    if (parsed.value !== undefined) values[key] = parsed.value;
  }
  return { name, inGame, values };
}

/** Reads the ADS form. Every box is optional, but at least one value is needed. */
export function readAdsForm(form: { adsSens: string; precision: string; easing: string; fireSens: string; notes: string }):
  | { values: Partial<Record<SettingKey, number>>; notes: string }
  | { error: string } {
  const values: Partial<Record<SettingKey, number>> = {};
  for (const key of ADS_KEYS) {
    const parsed = parseSettingValue(key, form[key as 'adsSens' | 'precision' | 'easing' | 'fireSens'], false);
    if ('error' in parsed) return parsed;
    if (parsed.value !== undefined) values[key] = parsed.value;
  }
  const notes = form.notes.trim();
  if (Object.keys(values).length === 0 && !notes) return { error: 'Fill in at least one ADS value, or press Post it to share without ADS.' };
  return { values, notes };
}

/** Minutes until this member may share again, or 0 if they can share now. */
export function cooldownMinutesLeft(last: number | undefined, now: number): number {
  if (last === undefined) return 0;
  const left = SHARE_COOLDOWN_MS - (now - last);
  return left > 0 ? Math.ceil(left / 60_000) : 0;
}

function valueFields(draft: SettingsDraft, keys: SettingKey[]): APIEmbedField[] {
  return keys
    .filter((key) => draft.values[key] !== undefined)
    .map((key) => ({ name: SETTING_FIELDS[key].name, value: `\`${draft.values[key]}\``, inline: true }));
}

/** Pads a row of inline fields to three, so the next section starts on a fresh row. */
function padRow(fields: APIEmbedField[]): APIEmbedField[] {
  const padded = [...fields];
  while (padded.length % 3 !== 0) padded.push({ name: '​', value: '​', inline: true });
  return padded;
}

/** The shared card: a stat sheet with the member's name, tags, recoil and ADS values. */
export function buildSettingsCard(draft: SettingsDraft, author: { name: string; iconURL?: string }, thumbnail?: string): EmbedBuilder {
  const tags = [draft.playstyle, draft.weapon].filter(Boolean).map((tag) => `**${tag}**`).join('  ·  ');
  const embed = new EmbedBuilder()
    .setColor(SETTINGS_COLOUR)
    .setAuthor({ name: author.name, iconURL: author.iconURL })
    .setTitle(draft.name || 'Untitled setup')
    .setFooter({ text: 'T.C.P v2.0 · Values assume a similar DayZ sensitivity. Tune one setting at a time.' })
    .setTimestamp();
  if (tags) embed.setDescription(tags);
  if (thumbnail) embed.setThumbnail(thumbnail);

  const fields: APIEmbedField[] = [];
  const recoil = valueFields(draft, RECOIL_KEYS);
  if (recoil.length > 0) {
    fields.push({ name: 'ANTI-RECOIL', value: '​', inline: false }, ...padRow(recoil));
  }
  const ads = valueFields(draft, ADS_KEYS);
  if (ads.length > 0) {
    fields.push({ name: 'ADS ACCURACY', value: '​', inline: false }, ...padRow(ads));
  }
  fields.push({ name: 'DayZ in-game sensitivity', value: draft.inGame || '—', inline: false });
  if (draft.notes) fields.push({ name: 'Notes', value: draft.notes, inline: false });
  return embed.addFields(fields);
}

/** "How to apply": which menu page each value on a card goes on, read back from the card's fields. */
export function applyGuide(fields: { name: string; value: string }[]): string {
  const byName = new Map(fields.map((field) => [field.name, field.value.replace(/`/g, '').trim()]));
  const lines = (Object.keys(SETTING_FIELDS) as SettingKey[])
    .filter((key) => byName.has(SETTING_FIELDS[key].name))
    .sort((a, b) => SETTING_FIELDS[a].page - SETTING_FIELDS[b].page)
    .map((key) => `\`Page ${SETTING_FIELDS[key].page}\` ${SETTING_FIELDS[key].menu} → **${byName.get(SETTING_FIELDS[key].name)}**`);
  if (lines.length === 0) return 'This card has no values to apply.';
  const inGame = byName.get('DayZ in-game sensitivity');
  return [
    '**On your Zen:** hold L2 + OPTIONS (LT + Menu on Xbox) to open the menu, LEFT/RIGHT to the page, UP/DOWN to set the value (hold X/A for steps of 10), then Circle/B to save.',
    '',
    ...lines,
    '',
    inGame ? `These values were made with a DayZ in-game aiming sensitivity of **${inGame}**. If yours is different, expect to adjust Vertical.` : '',
  ].join('\n').trim();
}

export function buildSettingsPanel() {
  const embed = new EmbedBuilder()
    .setTitle('Share your T.C.P settings')
    .setColor(SETTINGS_COLOUR)
    .setDescription(
      [
        'Found a setup that works? Share it and help the community dial in.',
        '',
        '**How it works**',
        '`1` Pick your playstyle and weapon',
        '`2` Enter your anti-recoil values',
        '`3` Add your ADS values (optional)',
        '`4` Check the preview and post it',
        '',
        'Every card has a **How to apply** button that shows the exact menu page for each value.',
      ].join('\n'),
    );
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(SETTINGS_BUTTON_ID).setLabel('Share my settings').setStyle(ButtonStyle.Success),
  );
  return { embeds: [embed], components: [row] };
}

export async function ensureSettingsPanel(client: Client): Promise<void> {
  if (!env.SETTINGS_CHANNEL_ID) {
    logger.info('[TCP Settings] SETTINGS_CHANNEL_ID not set; settings sharing disabled.');
    return;
  }
  await ensurePanel(client, env.SETTINGS_CHANNEL_ID, SETTINGS_BUTTON_ID, buildSettingsPanel(), 'settings');
}

// ---- wizard screens --------------------------------------------------------------------------

function selectRow(id: string, placeholder: string, options: readonly string[], chosen?: string) {
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(id)
      .setPlaceholder(placeholder)
      .addOptions(options.map((option) => ({ label: option, value: option, default: option === chosen }))),
  );
}

function stepOne(draft: SettingsDraft) {
  return {
    content: '**Step 1 of 3 · Playstyle and weapon**\nPick both, then press Next.',
    embeds: [],
    components: [
      selectRow(STYLE_SELECT_ID, 'Playstyle', PLAYSTYLES, draft.playstyle),
      selectRow(WEAPON_SELECT_ID, 'Weapon', WEAPONS, draft.weapon),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(NEXT_ID)
          .setLabel('Next: anti-recoil')
          .setStyle(ButtonStyle.Primary)
          .setDisabled(!draft.playstyle || !draft.weapon),
        new ButtonBuilder().setCustomId(CANCEL_ID).setLabel('Cancel').setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}

function previewScreen(draft: SettingsDraft, author: { name: string; iconURL?: string }, thumbnail?: string, notice = '') {
  const header = draft.hasAds ? '**Preview.** Happy with it? Post it, or edit any part.' : '**Step 3 of 3 · ADS (optional)**\nAdd your ADS values, or post it as it is.';
  return {
    content: [notice, header].filter(Boolean).join('\n'),
    embeds: [buildSettingsCard(draft, author, thumbnail)],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(POST_ID).setLabel('Post it').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(ADD_ADS_ID).setLabel(draft.hasAds ? 'Edit ADS' : 'Add ADS values').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(EDIT_RECOIL_ID).setLabel('Edit anti-recoil').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(CANCEL_ID).setLabel('Cancel').setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}

function input(id: string, label: string, required: boolean, placeholder: string, value: string | undefined, style = TextInputStyle.Short, max = 4) {
  const box = new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(style).setRequired(required).setMaxLength(max).setPlaceholder(placeholder);
  if (value) box.setValue(value);
  return new ActionRowBuilder<TextInputBuilder>().addComponents(box);
}

function recoilModal(draft: SettingsDraft) {
  const t = draft.typed;
  return new ModalBuilder()
    .setCustomId(RECOIL_MODAL_ID)
    .setTitle('Step 2 of 3 · Anti-recoil')
    .addComponents(
      input('name', 'Setup name', true, 'Long range M4', t.name, TextInputStyle.Short, 60),
      input('vertical', 'Vertical Recoil (0 to 100)', true, '26', t.vertical),
      input('horizontal', 'Horizontal Recoil (-50 to 50, optional)', false, '0', t.horizontal),
      input('turn', 'Turn Strength (0 to 100, optional)', false, '40', t.turn),
      input('inGame', 'DayZ in-game aiming sensitivity', true, 'Vertical 3 / Horizontal 5', t.inGame, TextInputStyle.Short, 60),
    );
}

function adsModal(draft: SettingsDraft) {
  const t = draft.typed;
  return new ModalBuilder()
    .setCustomId(ADS_MODAL_ID)
    .setTitle('Step 3 of 3 · ADS (all optional)')
    .addComponents(
      input('adsSens', 'ADS Sens (0 to 100)', false, '60', t.adsSens),
      input('precision', 'Precision (0 to 100)', false, '30', t.precision),
      input('easing', 'Easing (0 to 100)', false, '12', t.easing),
      input('fireSens', 'Fire Sens (20 to 100)', false, '75', t.fireSens),
      input('notes', 'Notes', false, 'Gun, range, playstyle, anything that helps', t.notes, TextInputStyle.Paragraph, 500),
    );
}

const ended = (content: string) => ({ content, embeds: [], components: [] });

// ---- interaction handling ----------------------------------------------------------------------

export async function handleSettingsInteraction(interaction: Interaction): Promise<boolean> {
  if (!interaction.isButton() && !interaction.isModalSubmit() && !interaction.isStringSelectMenu()) return false;
  const id = interaction.customId;
  if (!id.startsWith(PREFIX)) return false;

  // "How to apply" on a posted card works for anyone, any time.
  if (interaction.isButton() && id === APPLY_ID) {
    const fields = interaction.message.embeds[0]?.fields ?? [];
    await interaction.reply({ content: applyGuide(fields), ephemeral: true });
    return true;
  }

  if (!env.SETTINGS_CHANNEL_ID) {
    await interaction.reply({ content: 'Settings sharing is not set up yet.', ephemeral: true });
    return true;
  }
  const userId = interaction.user.id;
  const now = Date.now();
  const author = { name: interaction.user.displayName ?? interaction.user.username, iconURL: interaction.user.displayAvatarURL() };
  const thumbnail = interaction.client.user?.displayAvatarURL();

  if (interaction.isButton() && id === SETTINGS_BUTTON_ID) {
    const wait = cooldownMinutesLeft(lastShare.get(userId), now);
    if (wait > 0) {
      await interaction.reply({ content: `You shared a setup recently. You can share another in ${wait} minute${wait === 1 ? '' : 's'}.`, ephemeral: true });
      return true;
    }
    const draft = newDraft(now);
    drafts.set(userId, draft);
    await interaction.reply({ ...stepOne(draft), ephemeral: true });
    return true;
  }

  const draft = drafts.get(userId);
  if (!draft || now - draft.createdAt > DRAFT_LIFETIME_MS) {
    drafts.delete(userId);
    const message = ended('This form has expired. Press **Share my settings** to start again.');
    if (interaction.isModalSubmit()) {
      if (interaction.isFromMessage()) await interaction.update(message);
      else await interaction.reply({ ...message, ephemeral: true });
    } else {
      await interaction.update(message);
    }
    return true;
  }

  if (interaction.isStringSelectMenu()) {
    if (id === STYLE_SELECT_ID) draft.playstyle = interaction.values[0];
    if (id === WEAPON_SELECT_ID) draft.weapon = interaction.values[0];
    await interaction.update(stepOne(draft));
    return true;
  }

  if (interaction.isButton()) {
    if (id === CANCEL_ID) {
      drafts.delete(userId);
      await interaction.update(ended('Cancelled. Nothing was posted.'));
      return true;
    }
    if (id === NEXT_ID || id === EDIT_RECOIL_ID) {
      await interaction.showModal(recoilModal(draft));
      return true;
    }
    if (id === ADD_ADS_ID) {
      await interaction.showModal(adsModal(draft));
      return true;
    }
    if (id === POST_ID) {
      const wait = cooldownMinutesLeft(lastShare.get(userId), now);
      if (wait > 0) {
        await interaction.update(ended(`You shared a setup recently. You can share another in ${wait} minute${wait === 1 ? '' : 's'}.`));
        return true;
      }
      try {
        const channel = await fetchSendableChannel(interaction.client, env.SETTINGS_CHANNEL_ID);
        if (!channel) throw new Error('SETTINGS_CHANNEL_ID is not a text channel');
        const apply = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId(APPLY_ID).setLabel('How to apply').setStyle(ButtonStyle.Secondary),
        );
        const message = await channel.send({ embeds: [buildSettingsCard(draft, author, thumbnail)], components: [apply], allowedMentions: { parse: [] } });
        lastShare.set(userId, now);
        drafts.delete(userId);
        logger.info(`[TCP Settings] ${userId} shared "${draft.name}"`);
        await interaction.update(ended(`Posted! Thanks for sharing: ${message.url}`));
        await repostPanel(interaction.client, channel, SETTINGS_BUTTON_ID, buildSettingsPanel());
      } catch (error) {
        logger.error({ err: error }, '[TCP Settings ERROR] Could not post a shared setup');
        await interaction.update(ended('Something went wrong posting your setup. Please try again later.'));
      }
      return true;
    }
    return false;
  }

  if (!interaction.isModalSubmit() || !interaction.isFromMessage()) return false;
  const value = (key: string) => interaction.fields.getTextInputValue(key);

  if (id === RECOIL_MODAL_ID) {
    for (const key of ['name', 'vertical', 'horizontal', 'turn', 'inGame']) draft.typed[key] = value(key);
    const result = readRecoilForm({ name: value('name'), vertical: value('vertical'), horizontal: value('horizontal'), turn: value('turn'), inGame: value('inGame') });
    if ('error' in result) {
      await interaction.update({
        content: `**Step 2 of 3 · Anti-recoil**\n${result.error} Press the button to fix it; what you typed is kept.`,
        embeds: [],
        components: [
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId(EDIT_RECOIL_ID).setLabel('Fix anti-recoil').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId(CANCEL_ID).setLabel('Cancel').setStyle(ButtonStyle.Secondary),
          ),
        ],
      });
      return true;
    }
    draft.name = result.name;
    draft.inGame = result.inGame;
    for (const key of RECOIL_KEYS) delete draft.values[key];
    Object.assign(draft.values, result.values);
    await interaction.update(previewScreen(draft, author, thumbnail));
    return true;
  }

  if (id === ADS_MODAL_ID) {
    for (const key of ['adsSens', 'precision', 'easing', 'fireSens', 'notes']) draft.typed[key] = value(key);
    const result = readAdsForm({ adsSens: value('adsSens'), precision: value('precision'), easing: value('easing'), fireSens: value('fireSens'), notes: value('notes') });
    if ('error' in result) {
      await interaction.update(previewScreen(draft, author, thumbnail, `⚠️ ${result.error}`));
      return true;
    }
    for (const key of ADS_KEYS) delete draft.values[key];
    Object.assign(draft.values, result.values);
    draft.notes = result.notes;
    draft.hasAds = true;
    await interaction.update(previewScreen(draft, author, thumbnail));
    return true;
  }
  return false;
}
