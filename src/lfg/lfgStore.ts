import { jsonStore } from '../database/jsonStore.js';
import { RATING_WINDOW_MS, readCard, readRep, communityOf, type Commend, type LfgCard, type Region, type Reputation } from './lfgRules.js';

// Squad Finder's records, in the bot_state table: every member's cards (one per community) and reputation
// ('lfg.players'), and every squad with its channels ('lfg.squads'). The queue and the ready checks live in
// memory only: a restart clears them, and members press Deploy again.

export interface LfgPlayer {
  cards: Record<string, LfgCard>;
  rep: Reputation;
  /** When this member was last pinged about each squadmate deploying. */
  matePings: Record<string, number>;
}

export type LfgPlayers = Record<string, LfgPlayer>;

export interface SquadRecord {
  id: string;
  community: string;
  guildId: string;
  callSign: string;
  platform: string;
  region: Region;
  language: string;
  mode: string;
  score: number;
  members: string[];
  /** Members who left; they can still rate the squad. */
  former: string[];
  textId: string;
  voiceId: string;
  createdAt: number;
  /** Looking for +1: the queue fills one more slot. */
  open: boolean;
  openedAt: number;
  endedAt: number | null;
  endReason: string | null;
  channelsDeleted: boolean;
  /** Who has rated this squad. */
  rated: string[];
}

export type Squads = Record<string, SquadRecord>;

export const playersStore = jsonStore<LfgPlayers>('lfg.players', () => ({}));
export const squadsStore = jsonStore<Squads>('lfg.squads', () => ({}));

/** A member's entry in full shape, made or repaired in place; cards that are no longer valid are dropped. */
export function lfgPlayerOf(players: LfgPlayers, userId: string): LfgPlayer {
  const stored = players[userId] as Partial<LfgPlayer> | undefined;
  const cards: Record<string, LfgCard> = {};
  for (const [key, card] of Object.entries(stored?.cards ?? {})) {
    const community = communityOf(key);
    const valid = community ? readCard(card, community) : null;
    if (valid) cards[key] = valid;
  }
  const matePings: Record<string, number> = {};
  for (const [id, at] of Object.entries(stored?.matePings ?? {})) if (Number(at) > 0) matePings[id] = Number(at);
  const player: LfgPlayer = { cards, rep: readRep(stored?.rep), matePings };
  players[userId] = player;
  return player;
}

/** A read-only view of a member (nothing written). */
export function peekPlayer(players: LfgPlayers, userId: string): LfgPlayer {
  return lfgPlayerOf({ [userId]: players[userId] } as LfgPlayers, userId);
}

export interface RatingPicks {
  commends: Commend[];
  again: boolean;
  betrayed: boolean;
}

/**
 * One member's ratings of their squadmates. A betrayal report replaces any commendation of that member;
 * "play again" goes on the rater's own list. Returns the members who just became low-trust.
 */
export function applyRatings(players: LfgPlayers, raterId: string, picks: Record<string, RatingPicks>, now: number, wasLowTrust: (rep: Reputation) => boolean): string[] {
  const rater = lfgPlayerOf(players, raterId);
  const flagged: string[] = [];
  for (const [targetId, pick] of Object.entries(picks)) {
    if (targetId === raterId) continue;
    const target = lfgPlayerOf(players, targetId);
    if (pick.betrayed) {
      const before = wasLowTrust(target.rep);
      target.rep.betrayedBy[raterId] = now;
      if (!before && wasLowTrust(target.rep)) flagged.push(targetId);
    } else {
      for (const commend of new Set(pick.commends)) target.rep.commends[commend] += 1;
    }
    if (pick.again && !pick.betrayed && !rater.rep.playAgain.includes(targetId)) rater.rep.playAgain.push(targetId);
    if (pick.betrayed) rater.rep.playAgain = rater.rep.playAgain.filter((id) => id !== targetId);
  }
  return flagged;
}

/** Squads whose ratings window has passed are forgotten. */
export function pruneSquads(squads: Squads, now: number): void {
  for (const [id, squad] of Object.entries(squads)) if (squad.endedAt && now - squad.endedAt > RATING_WINDOW_MS && squad.channelsDeleted) delete squads[id];
}
