import type { Difficulty } from './ticTacToeRules.js';

// Tic Tac Toe records and the leaderboard, free of Discord. Every player's record lives in one JSON value in
// the bot_state table ('ttt.stats'): their display name, their games against other members, and their games
// against T.C.P by difficulty.

export interface WLD {
  wins: number;
  losses: number;
  draws: number;
}

export interface PlayerStats {
  name: string;
  pvp: WLD;
  bot: Record<Difficulty, WLD>;
}

export type Stats = Record<string, PlayerStats>;
export type Result = 'win' | 'loss' | 'draw';

/** Points against another member: 3 for a win, 1 for a draw. */
export const PVP_POINTS = { win: 3, draw: 1 } as const;
/** Points against T.C.P. Hard cannot be beaten, so a draw there is worth more than an easy win. */
export const BOT_POINTS: Record<Difficulty, { win: number; draw: number }> = {
  easy: { win: 1, draw: 0 },
  normal: { win: 3, draw: 1 },
  hard: { win: 3, draw: 2 },
};

const count = (value: unknown) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
};
const readWLD = (value?: Partial<WLD>): WLD => ({ wins: count(value?.wins), losses: count(value?.losses), draws: count(value?.draws) });

/** A stored entry in full shape, whatever is missing from it. */
export function readPlayer(stored: Partial<PlayerStats> | undefined): PlayerStats {
  return {
    name: typeof stored?.name === 'string' && stored.name ? stored.name : 'Unknown player',
    pvp: readWLD(stored?.pvp),
    bot: { easy: readWLD(stored?.bot?.easy), normal: readWLD(stored?.bot?.normal), hard: readWLD(stored?.bot?.hard) },
  };
}

/** The player's entry in `stats`, made or repaired in place, with their current name. */
export function playerOf(stats: Stats, id: string, name?: string): PlayerStats {
  const player = readPlayer(stats[id]);
  if (name) player.name = name;
  stats[id] = player;
  return player;
}

export function addResult(record: WLD, result: Result): void {
  if (result === 'win') record.wins += 1;
  else if (result === 'loss') record.losses += 1;
  else record.draws += 1;
}

export const games = (record: WLD) => record.wins + record.losses + record.draws;
export const pvpPoints = (record: WLD) => record.wins * PVP_POINTS.win + record.draws * PVP_POINTS.draw;

export function botTotal(player: PlayerStats): WLD {
  const total: WLD = { wins: 0, losses: 0, draws: 0 };
  for (const record of Object.values(player.bot)) {
    total.wins += record.wins;
    total.losses += record.losses;
    total.draws += record.draws;
  }
  return total;
}

export function botPoints(player: PlayerStats): number {
  return (Object.keys(BOT_POINTS) as Difficulty[]).reduce(
    (sum, difficulty) => sum + player.bot[difficulty].wins * BOT_POINTS[difficulty].win + player.bot[difficulty].draws * BOT_POINTS[difficulty].draw,
    0,
  );
}

export interface Standing {
  id: string;
  name: string;
  points: number;
  record: WLD;
}

/** Everyone who has played that kind of game, best first: points, then wins, then fewer losses, then name. */
export function standings(stats: Stats, kind: 'pvp' | 'bot'): Standing[] {
  return Object.entries(stats)
    .map(([id, stored]) => {
      const player = readPlayer(stored);
      const record = kind === 'pvp' ? player.pvp : botTotal(player);
      return { id, name: player.name, points: kind === 'pvp' ? pvpPoints(record) : botPoints(player), record };
    })
    .filter((standing) => games(standing.record) > 0)
    .sort(
      (a, b) =>
        b.points - a.points || b.record.wins - a.record.wins || a.record.losses - b.record.losses || a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
    );
}
