import { getStateStrict, setState } from '../database/stateStore.js';
import { BAILOUT, DAILY_COOLDOWN_MS, MAX_OPEN_GAMES, START_BALANCE, bailoutClaim, betProblem, chips, dailyClaim } from './casinoRules.js';

// Every member's chips, in one JSON value in the bot_state table ('casino.players'). A bet is taken when a
// game starts and held under the game's ID (inPlay) until the game pays out; a restart refunds whatever is
// still held, since the games themselves live in memory. Changes run one at a time, and a value that cannot
// be read is never written over (getStateStrict).

export interface CasinoPlayer {
  name: string;
  balance: number;
  lastDaily: number;
  streak: number;
  lastBailout: number;
  /** Chips riding on games that have not ended, by game ID. */
  inPlay: Record<string, number>;
  wagered: number;
  paidOut: number;
  biggestWin: number;
  games: number;
}

export type Casino = Record<string, CasinoPlayer>;

const KEY = 'casino.players';

const whole = (value: unknown, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : fallback;
};

/** A stored entry in full shape; a member never seen before starts with the starting balance. */
export function readCasinoPlayer(stored: Partial<CasinoPlayer> | undefined): CasinoPlayer {
  const inPlay: Record<string, number> = {};
  for (const [gameId, amount] of Object.entries(stored?.inPlay ?? {})) if (whole(amount) > 0) inPlay[gameId] = whole(amount);
  return {
    name: typeof stored?.name === 'string' && stored.name ? stored.name : 'Unknown player',
    balance: stored ? whole(stored.balance) : START_BALANCE,
    lastDaily: whole(stored?.lastDaily),
    streak: whole(stored?.streak),
    lastBailout: whole(stored?.lastBailout),
    inPlay,
    wagered: whole(stored?.wagered),
    paidOut: whole(stored?.paidOut),
    biggestWin: whole(stored?.biggestWin),
    games: whole(stored?.games),
  };
}

export function casinoPlayerOf(casino: Casino, userId: string, name?: string): CasinoPlayer {
  const player = readCasinoPlayer(casino[userId]);
  if (name) player.name = name;
  casino[userId] = player;
  return player;
}

export const inPlayTotal = (player: CasinoPlayer) => Object.values(player.inPlay).reduce((sum, amount) => sum + amount, 0);

let queue: Promise<unknown> = Promise.resolve();

/** Changes the records, one change at a time. Throws when they cannot be read or saved. */
export function withCasino<T>(change: (casino: Casino, now: number) => T): Promise<T> {
  const run = queue.then(async () => {
    const casino = (await getStateStrict<Casino>(KEY)) ?? {};
    const result = change(casino, Date.now());
    await setState(KEY, casino);
    return result;
  });
  queue = run.catch(() => undefined);
  return run;
}

export async function readCasino(): Promise<Casino> {
  await queue;
  return (await getStateStrict<Casino>(KEY)) ?? {};
}

export type BetResult = { ok: true; balance: number } | { ok: false; reason: string };

/** Takes a bet for a new game and holds it under the game's ID. */
export function placeBet(userId: string, name: string, gameId: string, bet: number): Promise<BetResult> {
  return withCasino((casino): BetResult => {
    const player = casinoPlayerOf(casino, userId, name);
    if (Object.keys(player.inPlay).length >= MAX_OPEN_GAMES) return { ok: false, reason: `You have ${MAX_OPEN_GAMES} games going. Finish one first.` };
    const problem = betProblem(bet, player.balance);
    if (problem) return { ok: false, reason: problem };
    player.balance -= bet;
    player.inPlay[gameId] = bet;
    player.wagered += bet;
    return { ok: true, balance: player.balance };
  });
}

/** Adds to a game's bet (a Blackjack double). */
export function raiseBet(userId: string, gameId: string, amount: number): Promise<BetResult> {
  return withCasino((casino): BetResult => {
    const player = casinoPlayerOf(casino, userId);
    if (!(gameId in player.inPlay)) return { ok: false, reason: 'That game is over.' };
    if (amount > player.balance) return { ok: false, reason: `You need ${chips(amount)} more to double and have ${chips(player.balance)}.` };
    player.balance -= amount;
    player.inPlay[gameId]! += amount;
    player.wagered += amount;
    return { ok: true, balance: player.balance };
  });
}

/**
 * Ends a game: pays `payout` (stake included; 0 for a loss) and releases the bet. Null when the game was
 * already settled or refunded, so nothing is ever paid twice.
 */
export function settleBet(userId: string, gameId: string, payout: number): Promise<{ balance: number; stake: number } | null> {
  return withCasino((casino) => {
    const player = casinoPlayerOf(casino, userId);
    const stake = player.inPlay[gameId];
    if (stake === undefined) return null;
    delete player.inPlay[gameId];
    player.balance += payout;
    player.paidOut += payout;
    player.games += 1;
    player.biggestWin = Math.max(player.biggestWin, payout - stake);
    return { balance: player.balance, stake };
  });
}

/** Gives a game's bet back, as if it was never placed (a declined duel, a game cut off by a restart). */
export function refundBet(userId: string, gameId: string): Promise<{ balance: number; stake: number } | null> {
  return withCasino((casino) => {
    const player = casinoPlayerOf(casino, userId);
    const stake = player.inPlay[gameId];
    if (stake === undefined) return null;
    delete player.inPlay[gameId];
    player.balance += stake;
    player.wagered = Math.max(0, player.wagered - stake);
    return { balance: player.balance, stake };
  });
}

/** On startup: every bet still held belongs to a game that was in memory, so it goes back. */
export function refundEverything(): Promise<number> {
  return withCasino((casino) => {
    let refunded = 0;
    for (const userId of Object.keys(casino)) {
      const player = casinoPlayerOf(casino, userId);
      for (const [gameId, stake] of Object.entries(player.inPlay)) {
        player.balance += stake;
        player.wagered = Math.max(0, player.wagered - stake);
        delete player.inPlay[gameId];
        refunded += 1;
      }
    }
    return refunded;
  });
}

export type ClaimResult =
  | { kind: 'daily'; amount: number; streak: number; balance: number; nextAt: number }
  | { kind: 'bailout'; amount: number; balance: number; nextDailyAt: number }
  | { kind: 'wait'; balance: number; nextDailyAt: number; nextBailoutAt: number | null };

/** The daily claim, or a bailout for a broke member whose daily is not ready yet. */
export function claimChips(userId: string, name: string): Promise<ClaimResult> {
  return withCasino((casino, now): ClaimResult => {
    const player = casinoPlayerOf(casino, userId, name);
    const daily = dailyClaim(player.lastDaily, player.streak, now);
    if (daily.ok) {
      player.balance += daily.amount;
      player.lastDaily = now;
      player.streak = daily.streak;
      return { kind: 'daily', amount: daily.amount, streak: daily.streak, balance: player.balance, nextAt: now + DAILY_COOLDOWN_MS };
    }
    const bailout = bailoutClaim(player.balance, inPlayTotal(player), player.lastBailout, now);
    if (bailout.ok) {
      player.balance += BAILOUT;
      player.lastBailout = now;
      return { kind: 'bailout', amount: BAILOUT, balance: player.balance, nextDailyAt: daily.nextAt };
    }
    return { kind: 'wait', balance: player.balance, nextDailyAt: daily.nextAt, nextBailoutAt: bailout.nextAt };
  });
}

/** The member's entry as it is now (made with the starting balance if they never played). */
export async function playerSnapshot(userId: string, name: string): Promise<CasinoPlayer> {
  return withCasino((casino) => ({ ...casinoPlayerOf(casino, userId, name) }));
}
