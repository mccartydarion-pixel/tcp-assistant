// Squad Finder (LFG): the rules, free of Discord so the matching can be tested. Each game community (a
// server category with an "lfg" channel) has its own card fields, queue, squads and board; reputation is
// the member's own, across communities.

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** A hard filter, unless the community's game has crossplay (Community.crossplay). */
// ps / xbox where a game's generations play together; ps5 / ps4 / xsx / xone where they do not (GTA Online).
export type Platform = 'ps' | 'xbox' | 'pc' | 'ps5' | 'ps4' | 'xsx' | 'xone';
export const PLATFORMS: Record<Platform, string> = {
  ps: 'PlayStation',
  xbox: 'Xbox',
  pc: 'PC',
  ps5: 'PS5',
  ps4: 'PS4',
  xsx: 'Xbox Series X|S',
  xone: 'Xbox One',
};

export const REGIONS = { nae: 'NA East', naw: 'NA West', eu: 'Europe', oce: 'Oceania', sa: 'South America', asia: 'Asia' } as const;
export type Region = keyof typeof REGIONS;
const NORTH_AMERICA: readonly Region[] = ['nae', 'naw'];

export const LANGUAGES = { en: 'English', es: 'Español', pt: 'Português', fr: 'Français', de: 'Deutsch', other: 'Other' } as const;
export type Language = keyof typeof LANGUAGES;

export const MICS = { yes: '🎙️ Mic', listen: '🎧 Listen only', no: '🔇 No mic' } as const;
export type Mic = keyof typeof MICS;

export const EXPERIENCE = { new: '🌱 New (under 100 h)', experienced: '🎒 Experienced', veteran: '🎖️ Veteran (1,000 h+)' } as const;
export type Experience = keyof typeof EXPERIENCE;
const EXPERIENCE_RANK: Record<Experience, number> = { new: 0, experienced: 1, veteran: 2 };

/** Squad sizes a member can ask for; 0 is "any size". */
export const SIZES: Record<number, string> = { 0: 'Any size', 2: 'Duo (2)', 3: 'Trio (3)', 4: 'Squad of 4', 5: 'Squad of 5' };
export const MAX_SQUAD = 5;
const DEFAULT_TARGET = 4;

export interface Community {
  key: string;
  name: string;
  /** The server category this community lives in; its "lfg" channel carries the panel. */
  categoryMatch: RegExp;
  /** The lfg channel's ID, when the owner gave it: found by ID first, by name otherwise. */
  lfgChannelId?: string;
  /** The platforms the game is on, and whether players on different ones can be matched together. */
  platforms: Platform[];
  crossplay: boolean;
  /** The biggest squad the game takes. */
  maxSquad: number;
  /** What the card is called ("Survivor ID") and the players ("survivor", "survivors"). */
  cardName: string;
  person: string;
  people: string;
  playstyles: Record<string, string>;
  /** The card's last choice: the servers (DayZ) or modes (Battlefield) a member plays. */
  servers: Record<string, string>;
  serverLabel: string;
  serverPrompt: string;
  /** Shown in a new squad's channel when one of its members picked one of these servers. */
  serverTip?: { servers: string[]; text: string };
}

export const COMMUNITIES: readonly Community[] = [
  {
    key: 'dayz',
    name: 'DayZ',
    categoryMatch: /dayz/i,
    // DayZ has no crossplay.
    platforms: ['ps', 'xbox'],
    crossplay: false,
    maxSquad: 5,
    cardName: 'Survivor ID',
    person: 'survivor',
    people: 'survivors',
    serverLabel: 'Server',
    serverPrompt: 'Servers you play',
    playstyles: {
      pvp: '⚔️ PvP hunter',
      pve: '🏕️ Survival / PvE',
      base: '🏗️ Base building',
      raid: '💣 Raiding',
      mil: '🎒 Military loot runs',
      fresh: '🌊 Fresh spawn grind',
      chill: '🗣️ Chill / chat',
    },
    servers: { official: '🌐 Official servers', community: '🧩 Community / modded', daynite: '🌗 Day & Nite (our server)' },
    serverTip: {
      servers: ['community', 'daynite'],
      text: '🌗 Need a community server? **Day & Nite** (Vanilla++, factions, PvP): https://discord.gg/26Vwz66aKV',
    },
  },
  {
    key: 'bf6',
    name: 'Battlefield 6',
    categoryMatch: /battlefield/i,
    lfgChannelId: '1569930588218064956',
    // Battlefield 6 has crossplay: PlayStation, Xbox and PC players are matched together.
    platforms: ['ps', 'xbox', 'pc'],
    crossplay: true,
    maxSquad: 4,
    cardName: 'Soldier ID',
    person: 'soldier',
    people: 'soldiers',
    serverLabel: 'Modes',
    serverPrompt: 'Modes you play',
    playstyles: {
      obj: '🎯 Objective player',
      slayer: '⚔️ Slayer',
      vehicles: '🚁 Vehicles / pilot',
      support: '🩹 Support / revives',
      recon: '🔭 Recon / sniper',
      engineer: '🛠️ Engineer',
      chill: '🗣️ Chill / chat',
    },
    servers: {
      large: '⚔️ Large-scale (Conquest, Breakthrough, Rush)',
      close: '🏙️ Close quarters (Domination, TDM)',
      redsec: '🪂 REDSEC battle royale',
      portal: '🧩 Portal / custom',
    },
  },
  {
    key: 'gta5',
    name: 'GTA V',
    categoryMatch: /gta|grand theft/i,
    // GTA Online has no crossplay, and PS5 / PS4 and Xbox Series / Xbox One play apart: each is its own platform.
    platforms: ['ps5', 'ps4', 'xsx', 'xone'],
    crossplay: false,
    maxSquad: 4,
    cardName: 'Crew ID',
    person: 'player',
    people: 'players',
    serverLabel: 'Sessions',
    serverPrompt: 'Sessions you play',
    playstyles: {
      heists: '💰 Heists',
      freeroam: '🏙️ Free roam',
      pvp: '⚔️ PvP / bounties',
      races: '🏁 Races',
      business: '💼 Business grinding',
      missions: '🎯 Missions / contacts',
      chill: '🗣️ Chill / cruising',
    },
    servers: {
      public: '🌐 Public sessions',
      crew: '🔒 Crew / invite-only sessions',
      any: '🎲 Either',
    },
  },
];

export const communityOf = (key: string) => COMMUNITIES.find((community) => community.key === key);

export interface LfgCard {
  platform: Platform;
  region: Region;
  language: Language;
  playstyles: string[];
  mic: Mic;
  experience: Experience;
  server: string;
  gamertag: string;
  bio: string;
  updatedAt: number;
}

const isKey = <T extends object>(table: T, value: unknown): value is keyof T => typeof value === 'string' && Object.prototype.hasOwnProperty.call(table, value);

/** A stored or drafted card in full, valid shape, or null when something is missing or no longer valid. */
export function readCard(stored: Partial<LfgCard> | undefined, community: Community): LfgCard | null {
  if (!stored) return null;
  const playstyles = Array.isArray(stored.playstyles) ? stored.playstyles.filter((style) => isKey(community.playstyles, style)).slice(0, 3) : [];
  if (
    !isKey(PLATFORMS, stored.platform) ||
    !community.platforms.includes(stored.platform) ||
    !isKey(REGIONS, stored.region) ||
    !isKey(LANGUAGES, stored.language) ||
    !isKey(MICS, stored.mic) ||
    !isKey(EXPERIENCE, stored.experience) ||
    !isKey(community.servers, stored.server) ||
    playstyles.length === 0 ||
    typeof stored.gamertag !== 'string' ||
    !stored.gamertag.trim()
  )
    return null;
  return {
    platform: stored.platform,
    region: stored.region,
    language: stored.language,
    playstyles,
    mic: stored.mic,
    experience: stored.experience,
    server: stored.server,
    gamertag: stored.gamertag.trim().slice(0, 32),
    bio: typeof stored.bio === 'string' ? stored.bio.trim().slice(0, 120) : '',
    updatedAt: Number(stored.updatedAt) || 0,
  };
}

// ---- reputation ---------------------------------------------------------------------------------------

export const COMMENDS = { comms: '🎙️ Great comms', trust: '🛡️ Trustworthy', clutch: '🎯 Clutch', chill: '😎 Chill', leader: '🧭 Good leader' } as const;
export type Commend = keyof typeof COMMENDS;
const COMMEND_EMOJI: Record<Commend, string> = { comms: '🎙️', trust: '🛡️', clutch: '🎯', chill: '😎', leader: '🧭' };

export interface Reputation {
  commends: Record<Commend, number>;
  /** Who reported this member for betraying their squad, and when (private). */
  betrayedBy: Record<string, number>;
  squads: number;
  /** Members this one said they would play with again. */
  playAgain: string[];
}

export function readRep(stored: Partial<Reputation> | undefined): Reputation {
  const commends = {} as Record<Commend, number>;
  for (const key of Object.keys(COMMENDS) as Commend[]) commends[key] = Math.max(0, Math.floor(Number(stored?.commends?.[key]) || 0));
  const betrayedBy: Record<string, number> = {};
  for (const [reporter, at] of Object.entries(stored?.betrayedBy ?? {})) if (Number(at) > 0) betrayedBy[reporter] = Number(at);
  return {
    commends,
    betrayedBy,
    squads: Math.max(0, Math.floor(Number(stored?.squads) || 0)),
    playAgain: Array.isArray(stored?.playAgain) ? stored.playAgain.filter((id) => typeof id === 'string') : [],
  };
}

/** Reports from this many different members within 60 days make a member low-trust. */
export const LOW_TRUST_REPORTS = 3;
export const REPORT_WINDOW_MS = 60 * DAY;

export const betrayalReports = (rep: Reputation, now: number) => Object.values(rep.betrayedBy).filter((at) => now - at <= REPORT_WINDOW_MS).length;
export const isLowTrust = (rep: Reputation, now: number) => betrayalReports(rep, now) >= LOW_TRUST_REPORTS;
export const totalCommends = (rep: Reputation) => Object.values(rep.commends).reduce((sum, count) => sum + count, 0);

/** The member's best commendations, most first: "🛡️ ×14 · 🎙️ ×9". */
export function badges(rep: Reputation, max = 3): string {
  return (Object.entries(rep.commends) as [Commend, number][])
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([key, count]) => `${COMMEND_EMOJI[key]} ×${count}`)
    .join(' · ');
}

/** Members who said they would play again with each other. */
export const mutualMates = (rep: Reputation, otherRep: Reputation, id: string, otherId: string) => rep.playAgain.includes(otherId) && otherRep.playAgain.includes(id);

// ---- timings ------------------------------------------------------------------------------------------

export const QUEUE_MAX_MS = 45 * MINUTE;
export const READY_MS = 2 * MINUTE;
export const RELAX_EXPERIENCE_MS = 2 * MINUTE;
export const RELAX_REGION_MS = 3 * MINUTE;
export const RELAX_SIZE_MS = 5 * MINUTE;
/** Elite Supporters count as having waited this much longer: priority in the queue. */
export const ELITE_HEAD_START_MS = 3 * MINUTE;
export const SQUAD_IDLE_MS = 60 * MINUTE;
export const SQUAD_MIN_AGE_MS = 20 * MINUTE;
export const SQUAD_MAX_MS = 12 * HOUR;
/** After a squad ends its channels stay this long, for the ratings. */
export const SQUAD_CLOSE_MS = 10 * MINUTE;
export const RATING_WINDOW_MS = 24 * HOUR;
export const MATE_PING_MS = 6 * HOUR;

// ---- matching -----------------------------------------------------------------------------------------

/** A member in the queue: their card and what they want right now. */
export interface Seeker {
  userId: string;
  community: string;
  card: LfgCard;
  /** A playstyle key, or 'any'. */
  mode: string;
  /** 2-5, or 0 for any size. */
  size: number;
  since: number;
  lowTrust: boolean;
  elite: boolean;
  /** Members never to be matched with (betrayal reports either way). */
  avoid: string[];
  /** Mutual squadmates. */
  mates: string[];
}

export const priorityTime = (seeker: Seeker) => seeker.since - (seeker.elite ? ELITE_HEAD_START_MS : 0);
export const waited = (seeker: Seeker, now: number) => now - priorityTime(seeker);

/** The hard rules: same community, platform and language, region (NA East and West mix after 3 minutes), trust, nobody avoided, and no new player with a veteran in the first 2 minutes. */
export function compatible(a: Seeker, b: Seeker, now: number): boolean {
  if (a.userId === b.userId || a.community !== b.community) return false;
  if (a.card.language !== b.card.language) return false;
  if (a.card.platform !== b.card.platform && !communityOf(a.community)?.crossplay) return false;
  if (a.lowTrust !== b.lowTrust) return false;
  if (a.avoid.includes(b.userId) || b.avoid.includes(a.userId)) return false;
  const longest = Math.max(waited(a, now), waited(b, now));
  if (a.card.region !== b.card.region) {
    const bothNorthAmerica = NORTH_AMERICA.includes(a.card.region) && NORTH_AMERICA.includes(b.card.region);
    if (!bothNorthAmerica || longest < RELAX_REGION_MS) return false;
  }
  if (Math.abs(EXPERIENCE_RANK[a.card.experience] - EXPERIENCE_RANK[b.card.experience]) > 1 && longest < RELAX_EXPERIENCE_MS) return false;
  return true;
}

const MIC_SCORE: Record<Mic, Record<Mic, number>> = {
  yes: { yes: 20, listen: 12, no: 0 },
  listen: { yes: 12, listen: 10, no: 6 },
  no: { yes: 0, listen: 6, no: 10 },
};

/** How well two members fit, 0-100: the mode for this session, their playstyles, mics, experience and server. */
export function pairScore(a: Seeker, b: Seeker): number {
  let score = 0;
  if (a.mode !== 'any' && a.mode === b.mode) score += 35;
  else if (a.mode === 'any' && b.mode === 'any') score += 25;
  else if (a.mode === 'any' || b.mode === 'any') {
    const specific = a.mode === 'any' ? b.mode : a.mode;
    const flexible = a.mode === 'any' ? a : b;
    score += flexible.card.playstyles.includes(specific) ? 30 : 20;
  } else if (a.card.playstyles.includes(b.mode) && b.card.playstyles.includes(a.mode)) score += 10;
  const shared = a.card.playstyles.filter((style) => b.card.playstyles.includes(style)).length;
  score += Math.round((15 * shared) / Math.max(1, Math.min(a.card.playstyles.length, b.card.playstyles.length)));
  score += MIC_SCORE[a.card.mic][b.card.mic];
  score += [15, 8, 0][Math.abs(EXPERIENCE_RANK[a.card.experience] - EXPERIENCE_RANK[b.card.experience])]!;
  score += a.card.server === b.card.server ? 15 : 3;
  if (a.mates.includes(b.userId) || b.mates.includes(a.userId)) score += 10;
  return Math.min(100, score);
}

export function groupScore(group: Seeker[]): number {
  let total = 0;
  let pairs = 0;
  for (let i = 0; i < group.length; i += 1)
    for (let j = i + 1; j < group.length; j += 1) {
      total += pairScore(group[i]!, group[j]!);
      pairs += 1;
    }
  return pairs === 0 ? 100 : Math.round(total / pairs);
}

/** The lowest match accepted: strict at first, looser the longer the oldest member has waited. */
export function scoreThreshold(waitMs: number): number {
  if (waitMs < 2 * MINUTE) return 55;
  if (waitMs < RELAX_SIZE_MS) return 40;
  return 25;
}

/** Whether a member is happy with a squad of n: their size, any size, or a smaller one after 5 minutes. */
export function sizeAccepts(seeker: Seeker, n: number, now: number): boolean {
  return seeker.size === 0 || seeker.size === n || (seeker.size > n && waited(seeker, now) >= RELAX_SIZE_MS);
}

function preferredSize(pool: Seeker[]): number {
  const counts = new Map<number, number>();
  for (const seeker of pool) if (seeker.size > 0) counts.set(seeker.size, (counts.get(seeker.size) ?? 0) + 1);
  let best = DEFAULT_TARGET;
  let bestCount = 0;
  for (const [size, count] of counts) if (count > bestCount || (count === bestCount && size > best)) [best, bestCount] = [size, count];
  return best;
}

export interface Match {
  members: Seeker[];
  score: number;
}

/**
 * Forms squads from the queue, longest wait first (Elite Supporters count 3 minutes more): each anchor
 * takes the best-fitting compatible members until the squad has its size; a squad smaller than asked for
 * is formed once its members accept that (after 5 minutes). A squad must score at least the threshold.
 */
export function formSquads(seekers: Seeker[], now: number): Match[] {
  const order = [...seekers].sort((a, b) => priorityTime(a) - priorityTime(b));
  const used = new Set<string>();
  const matches: Match[] = [];
  for (const anchor of order) {
    if (used.has(anchor.userId)) continue;
    const pool = order.filter((candidate) => candidate !== anchor && !used.has(candidate.userId) && compatible(anchor, candidate, now));
    if (pool.length === 0) continue;
    const target = Math.min(communityOf(anchor.community)?.maxSquad ?? MAX_SQUAD, anchor.size || preferredSize(pool));
    const group = [anchor];
    while (group.length < target) {
      let best: Seeker | null = null;
      let bestScore = -1;
      for (const candidate of pool) {
        if (group.includes(candidate) || !sizeAccepts(candidate, target, now) || !group.every((member) => compatible(member, candidate, now))) continue;
        const fit = group.reduce((sum, member) => sum + pairScore(member, candidate), 0) / group.length;
        if (fit > bestScore) [best, bestScore] = [candidate, fit];
      }
      if (!best) break;
      group.push(best);
    }
    if (group.length < 2 || !group.every((member) => sizeAccepts(member, group.length, now))) continue;
    const score = groupScore(group);
    if (score < scoreThreshold(waited(anchor, now))) continue;
    for (const member of group) used.add(member.userId);
    matches.push({ members: group, score });
  }
  return matches;
}

/** The member in the queue who best fills an open slot in a squad (its members as seekers), if any fits. */
export function bestJoiner(squad: Seeker[], seekers: Seeker[], now: number): Match | null {
  const size = squad.length + 1;
  let best: Match | null = null;
  for (const seeker of [...seekers].sort((a, b) => priorityTime(a) - priorityTime(b))) {
    // Anyone happy with any size, or who wanted a squad at least this big, can fill the slot.
    if (seeker.size !== 0 && seeker.size < size) continue;
    if (!squad.every((member) => compatible(member, seeker, now))) continue;
    const score = Math.round(squad.reduce((sum, member) => sum + pairScore(member, seeker), 0) / squad.length);
    if (score < scoreThreshold(waited(seeker, now))) continue;
    if (!best || score > best.score) best = { members: [seeker], score };
  }
  return best;
}

export const CALL_SIGNS = [
  'Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel', 'India', 'Juliet', 'Kilo', 'Lima', 'Mike',
  'November', 'Oscar', 'Papa', 'Quebec', 'Romeo', 'Sierra', 'Tango', 'Uniform', 'Victor', 'Whiskey', 'Xray', 'Yankee', 'Zulu',
];

export function callSign(rng: () => number): string {
  const name = CALL_SIGNS[Math.min(CALL_SIGNS.length - 1, Math.floor(rng() * CALL_SIGNS.length))]!;
  return `${name} ${String(1000 + Math.floor(rng() * 9000))}`;
}
