// The live status card in each script channel, free of Discord's network calls so it can be tested: which
// scripts there are, what a status holds, how a change applies, and what the card shows.

export type ScriptState = 'online' | 'updating' | 'down';

export const STATES: Record<ScriptState, { label: string; emoji: string; colour: number; blurb: (game: string) => string }> = {
  online: { label: 'ONLINE', emoji: '🟢', colour: 0x3ba55d, blurb: (game) => `Working on the current ${game} update.` },
  updating: { label: 'UPDATING', emoji: '🟡', colour: 0xf1c40f, blurb: (game) => `A ${game} update landed: a new build is on the way.` },
  down: { label: 'PAUSED', emoji: '🔴', colour: 0xe5322b, blurb: () => 'Something is broken right now: hold off until this is green again.' },
};

export const isState = (value: unknown): value is ScriptState => value === 'online' || value === 'updating' || value === 'down';

/** What a card shows; every text field is optional, and an empty one is simply left off the card. */
export interface ScriptDetails {
  edition: string;
  device: string;
  platforms: string;
  editions: string;
  features: string;
  changes: string;
  build: string;
  /** A web address for Download (scripts without the bot's own Premium download). */
  download: string;
}

export interface ScriptStatus extends ScriptDetails {
  state: ScriptState;
  note: string;
  /** When the state last changed, and when the build last changed (0: unknown). */
  changedAt: number;
  updatedAt: number;
}

export interface ScriptConfig {
  key: string;
  name: string;
  /** The script channel the card lives in. */
  channelId: string;
  /** The banner GIFs: assets/status/tcp-status-<slug>-<state>.gif. */
  slug: string;
  /** The DayZ script: Download Premium is the bot's own (Elite Supporters, personal copies). */
  premium: boolean;
  defaults: Partial<ScriptStatus>;
}

export const SCRIPTS: readonly ScriptConfig[] = [
  {
    key: 'dayz',
    name: 'DayZ',
    channelId: '1569631205987590254',
    slug: 'dayz',
    premium: true,
    defaults: {
      edition: 'T.C.P Premium',
      device: 'Cronus Zen',
      platforms: 'PS5 · PS4 · Xbox',
      editions: 'Premium · Free',
      features: 'Gen 8 anti-recoil · F.A.S.T. 2.0 aim · Weapon Workshop · Drop Roll · Rapid Fire · Hip Fire Speed · Menu 2.0',
      changes: 'Rapid Fire and Hip Fire Speed · smoother F.A.S.T. micro aim · sharper Workshop recordings',
      build: '2026.10.29',
      updatedAt: Date.UTC(2026, 9, 29, 19, 19),
    },
  },
  {
    key: 'bf6',
    name: 'Battlefield 6',
    channelId: '1569930663346446386',
    slug: 'bf6',
    premium: false,
    // Still being worked on (the owner, 2026-11-11): /tcp script switches it to Online when it ships.
    defaults: { edition: 'T.C.P', device: 'Cronus Zen', state: 'updating', note: 'Still being worked on: the T.C.P Battlefield 6 script is on its way.' },
  },
  { key: 'gta5', name: 'GTA V', channelId: '1570136255306404084', slug: 'gta5', premium: false, defaults: { edition: 'T.C.P', device: 'Cronus Zen' } },
];

export const scriptOf = (key: string) => SCRIPTS.find((script) => script.key === key);

const BLANK: ScriptStatus = {
  state: 'online',
  note: '',
  changedAt: 0,
  updatedAt: 0,
  edition: '',
  device: '',
  platforms: '',
  editions: '',
  features: '',
  changes: '',
  build: '',
  download: '',
};

/** The script's status: its stored values over its defaults, every field present and valid. */
export function effectiveStatus(script: ScriptConfig, stored: Partial<ScriptStatus> | undefined): ScriptStatus {
  const merged = { ...BLANK, ...script.defaults, ...(stored ?? {}) };
  const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
  const state = isState(merged.state) ? merged.state : 'online';
  // A default note belongs to the default state ("Still being worked on" while Updating): once the team sets
  // another state it goes, unless they wrote a note of their own.
  const note = stored?.note !== undefined ? stored.note : state === (script.defaults.state ?? 'online') ? script.defaults.note : '';
  return {
    state,
    note: text(note).slice(0, 300),
    changedAt: Number(merged.changedAt) || 0,
    updatedAt: Number(merged.updatedAt) || 0,
    edition: text(merged.edition).slice(0, 40),
    device: text(merged.device).slice(0, 60),
    platforms: text(merged.platforms).slice(0, 100),
    editions: text(merged.editions).slice(0, 100),
    features: text(merged.features).slice(0, 900),
    changes: text(merged.changes).slice(0, 900),
    build: text(merged.build).slice(0, 40),
    download: /^https?:\/\//i.test(text(merged.download)) ? text(merged.download).slice(0, 500) : '',
  };
}

/** What /tcp script asks to change; a text of "-" clears that field. */
export type StatusChange = Partial<Omit<ScriptStatus, 'changedAt' | 'updatedAt'>>;

/**
 * The stored values after a change: a new state stamps changedAt, a new build stamps updatedAt (now); "-"
 * clears a text field, so the card shows its default again or leaves it off.
 */
export function applyChange(stored: Partial<ScriptStatus>, current: ScriptStatus, change: StatusChange, now: number): Partial<ScriptStatus> {
  const next: Partial<ScriptStatus> = { ...stored };
  for (const [field, value] of Object.entries(change) as [keyof StatusChange, string | undefined][]) {
    if (value === undefined || value === null) continue;
    if (field === 'state') {
      if (isState(value) && value !== current.state) {
        next.state = value;
        next.changedAt = now;
      }
      continue;
    }
    const cleared = value.trim() === '-';
    (next as Record<string, string>)[field] = cleared ? '' : value.trim();
    if (field === 'build' && !cleared && value.trim() !== current.build) next.updatedAt = now;
  }
  return next;
}

/** The card's title, e.g. "🟢 DayZ · T.C.P Premium is ONLINE". */
export function cardTitle(script: ScriptConfig, status: ScriptStatus): string {
  const state = STATES[status.state];
  return `${state.emoji} ${script.name}${status.edition ? ` · ${status.edition}` : ''} is ${state.label}`;
}

export interface CardField {
  name: string;
  value: string;
  inline?: boolean;
}

/** The card's fields: whatever is known, in a fixed order; empty ones are left off. */
export function cardFields(status: ScriptStatus): CardField[] {
  const state = STATES[status.state];
  const fields: CardField[] = [{ name: 'Status', value: `${state.emoji} ${state.label.charAt(0)}${state.label.slice(1).toLowerCase()}`, inline: true }];
  if (status.build) fields.push({ name: 'Build', value: status.build, inline: true });
  if (status.updatedAt) fields.push({ name: 'Updated', value: `<t:${Math.floor(status.updatedAt / 1000)}:R>`, inline: true });
  if (status.device) fields.push({ name: 'Device', value: status.device, inline: true });
  if (status.platforms) fields.push({ name: 'Platforms', value: status.platforms, inline: true });
  if (status.editions) fields.push({ name: 'Editions', value: status.editions, inline: true });
  if (status.features) fields.push({ name: "What's in it", value: status.features });
  if (status.changes) fields.push({ name: 'Latest changes', value: status.changes });
  return fields;
}

export function cardDescription(script: ScriptConfig, status: ScriptStatus): string {
  const text = status.note || STATES[status.state].blurb(script.name);
  return status.changedAt ? `${text}\nLast status change <t:${Math.floor(status.changedAt / 1000)}:R>.` : text;
}

/** Everything the card shows, so it is only re-posted when something changed. */
export function cardSignature(script: ScriptConfig, status: ScriptStatus): string {
  return JSON.stringify([script.key, script.premium, status.state, status.note, status.changedAt, status.updatedAt, status.edition, status.device, status.platforms, status.editions, status.features, status.changes, status.build, status.download]);
}

export const bannerFile = (script: ScriptConfig, state: ScriptState) => `tcp-status-${script.slug}-${state}.gif`;
