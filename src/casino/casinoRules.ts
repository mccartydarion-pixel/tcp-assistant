// The T.C.P casino's rules, free of Discord so the odds can be tested. Play money only: chips are free
// (a daily claim and a bailout), can never be bought, sold, traded or swapped for anything real.

export const CHIP = '🪙';
export const START_BALANCE = 1000;
export const MIN_BET = 10;
export const MAX_BET = 10_000;
/** Games a member can have going at once (each holds its bet). */
export const MAX_OPEN_GAMES = 3;

const HOUR = 60 * 60 * 1000;
export const DAILY_BASE = 500;
export const DAILY_STREAK_STEP = 50;
/** The streak bonus stops growing after this many days in a row (+500). */
export const DAILY_STREAK_MAX = 10;
export const DAILY_COOLDOWN_MS = 20 * HOUR;
/** Claiming again within this long of the last claim keeps the streak. */
export const DAILY_STREAK_WINDOW_MS = 48 * HOUR;
export const BAILOUT = 100;
export const BAILOUT_COOLDOWN_MS = 2 * HOUR;

export const fmt = (amount: number) => Math.round(amount).toLocaleString('en-US');
export const chips = (amount: number) => `${CHIP} ${fmt(amount)}`;

export type Rng = () => number;

const pickIndex = (length: number, rng: Rng) => Math.min(length - 1, Math.floor(rng() * length));

export function betProblem(bet: number, balance: number): string | null {
  if (!Number.isInteger(bet) || bet < MIN_BET) return `The smallest bet is ${chips(MIN_BET)}.`;
  if (bet > MAX_BET) return `The biggest bet is ${chips(MAX_BET)}.`;
  if (bet > balance) return `You have ${chips(balance)}. Claim more with \`/casino daily\`.`;
  return null;
}

/** The daily claim: once every 20 hours, more for every day in a row (claimed within 48 hours of the last). */
export function dailyClaim(lastDaily: number, streak: number, now: number): { ok: true; amount: number; streak: number } | { ok: false; nextAt: number } {
  if (lastDaily > 0 && now - lastDaily < DAILY_COOLDOWN_MS) return { ok: false, nextAt: lastDaily + DAILY_COOLDOWN_MS };
  const next = lastDaily > 0 && now - lastDaily <= DAILY_STREAK_WINDOW_MS ? streak + 1 : 1;
  return { ok: true, streak: next, amount: DAILY_BASE + DAILY_STREAK_STEP * Math.min(next - 1, DAILY_STREAK_MAX) };
}

/** A broke member (under the smallest bet, nothing riding on a game) can take a small bailout every 2 hours. */
export function bailoutClaim(balance: number, inPlay: number, lastBailout: number, now: number): { ok: true } | { ok: false; nextAt: number | null } {
  if (balance >= MIN_BET || inPlay > 0) return { ok: false, nextAt: null };
  if (lastBailout > 0 && now - lastBailout < BAILOUT_COOLDOWN_MS) return { ok: false, nextAt: lastBailout + BAILOUT_COOLDOWN_MS };
  return { ok: true };
}

// ---- cards and Blackjack ----------------------------------------------------------------------------------

export interface Card {
  /** 1 = ace, 11-13 = J, Q, K. */
  rank: number;
  suit: number;
}

const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
export const cardText = (card: Card) => `${RANKS[card.rank]}${SUITS[card.suit]}`;

export const BLACKJACK_DECKS = 4;

/** A freshly shuffled shoe for one hand (no card counting across hands). */
export function newShoe(rng: Rng, decks = BLACKJACK_DECKS): Card[] {
  const shoe: Card[] = [];
  for (let deck = 0; deck < decks; deck += 1) for (let suit = 0; suit < 4; suit += 1) for (let rank = 1; rank <= 13; rank += 1) shoe.push({ rank, suit });
  for (let index = shoe.length - 1; index > 0; index -= 1) {
    const swap = pickIndex(index + 1, rng);
    [shoe[index], shoe[swap]] = [shoe[swap]!, shoe[index]!];
  }
  return shoe;
}

export function handValue(cards: Card[]): { total: number; soft: boolean } {
  let total = 0;
  let aces = 0;
  for (const card of cards) {
    total += Math.min(card.rank, 10);
    if (card.rank === 1) aces += 1;
  }
  // One ace counted as 11 when it fits.
  if (aces > 0 && total + 10 <= 21) return { total: total + 10, soft: true };
  return { total, soft: false };
}

export const isBlackjack = (cards: Card[]) => cards.length === 2 && handValue(cards).total === 21;

export type BlackjackResult = 'blackjack' | 'win' | 'dealer-bust' | 'push' | 'bust' | 'loss' | 'dealer-blackjack';

export interface BlackjackHand {
  shoe: Card[];
  player: Card[];
  dealer: Card[];
  /** The first bet. */
  bet: number;
  /** What is riding on the hand (twice the bet after a double). */
  stake: number;
  done: boolean;
  result: BlackjackResult | null;
  /** Chips paid back when the hand ends, stake included (0 for a loss). */
  payout: number;
}

const draw = (hand: BlackjackHand) => hand.shoe.pop()!;

function finish(hand: BlackjackHand, result: BlackjackResult): BlackjackHand {
  hand.done = true;
  hand.result = result;
  hand.payout =
    result === 'blackjack'
      ? hand.stake + Math.floor((hand.stake * 3) / 2)
      : result === 'win' || result === 'dealer-bust'
        ? hand.stake * 2
        : result === 'push'
          ? hand.stake
          : 0;
  return hand;
}

/** Deals a hand. A natural on either side ends it at once (the dealer checks for blackjack). */
export function blackjackDeal(bet: number, rng: Rng): BlackjackHand {
  const hand: BlackjackHand = { shoe: newShoe(rng), player: [], dealer: [], bet, stake: bet, done: false, result: null, payout: 0 };
  hand.player.push(draw(hand));
  hand.dealer.push(draw(hand));
  hand.player.push(draw(hand));
  hand.dealer.push(draw(hand));
  const player = isBlackjack(hand.player);
  const dealer = isBlackjack(hand.dealer);
  if (player && dealer) return finish(hand, 'push');
  if (player) return finish(hand, 'blackjack');
  if (dealer) return finish(hand, 'dealer-blackjack');
  return hand;
}

/** The dealer draws to 17 and stands on every 17, soft ones included; then the hands are compared. */
export function blackjackStand(hand: BlackjackHand): BlackjackHand {
  if (hand.done) return hand;
  while (handValue(hand.dealer).total < 17) hand.dealer.push(draw(hand));
  const player = handValue(hand.player).total;
  const dealer = handValue(hand.dealer).total;
  if (dealer > 21) return finish(hand, 'dealer-bust');
  if (player > dealer) return finish(hand, 'win');
  if (player === dealer) return finish(hand, 'push');
  return finish(hand, 'loss');
}

export function blackjackHit(hand: BlackjackHand): BlackjackHand {
  if (hand.done) return hand;
  hand.player.push(draw(hand));
  const total = handValue(hand.player).total;
  if (total > 21) return finish(hand, 'bust');
  return total === 21 ? blackjackStand(hand) : hand;
}

export const canDouble = (hand: BlackjackHand) => !hand.done && hand.player.length === 2 && hand.stake === hand.bet;

/** Doubles the stake, takes exactly one card and stands. The extra bet must already be taken. */
export function blackjackDouble(hand: BlackjackHand): BlackjackHand {
  if (!canDouble(hand)) return hand;
  hand.stake = hand.bet * 2;
  hand.player.push(draw(hand));
  if (handValue(hand.player).total > 21) return finish(hand, 'bust');
  return blackjackStand(hand);
}

// ---- Slots ----------------------------------------------------------------------------------------------

export interface SlotSymbol {
  emoji: string;
  name: string;
  /** Out of 100, the same on every reel. */
  weight: number;
  /** Paid for three in a row and for exactly two, in tenths of the bet (stake included). */
  three: number;
  two: number;
}

/** About 95% comes back on average (slotsReturn). */
export const SLOT_SYMBOLS: readonly SlotSymbol[] = [
  { emoji: '🥫', name: 'Beans', weight: 35, three: 40, two: 5 },
  { emoji: '🩹', name: 'Bandage', weight: 27, three: 60, two: 10 },
  { emoji: '🧟', name: 'Infected', weight: 20, three: 120, two: 10 },
  { emoji: '🔫', name: 'M4', weight: 13, three: 250, two: 20 },
  { emoji: '🎯', name: 'T.C.P', weight: 5, three: 1000, two: 50 },
];

export function spinReel(rng: Rng): number {
  let roll = rng() * 100;
  for (let index = 0; index < SLOT_SYMBOLS.length; index += 1) {
    roll -= SLOT_SYMBOLS[index]!.weight;
    if (roll < 0) return index;
  }
  return SLOT_SYMBOLS.length - 1;
}

export const spinSlots = (rng: Rng): [number, number, number] => [spinReel(rng), spinReel(rng), spinReel(rng)];

/** What three reels pay, in tenths of the bet: three of a kind, else a pair (any two), else nothing. */
export function slotsPayTenths(reels: readonly number[]): number {
  const [a, b, c] = reels as [number, number, number];
  if (a === b && b === c) return SLOT_SYMBOLS[a]!.three;
  if (a === b || a === c) return SLOT_SYMBOLS[a]!.two;
  if (b === c) return SLOT_SYMBOLS[b]!.two;
  return 0;
}

export const slotsPayout = (bet: number, reels: readonly number[]) => Math.floor((bet * slotsPayTenths(reels)) / 10);

/** The average share of a bet that comes back, over every spin weighted by its odds. */
export function slotsReturn(): number {
  let total = 0;
  for (let a = 0; a < SLOT_SYMBOLS.length; a += 1)
    for (let b = 0; b < SLOT_SYMBOLS.length; b += 1)
      for (let c = 0; c < SLOT_SYMBOLS.length; c += 1)
        total += ((SLOT_SYMBOLS[a]!.weight * SLOT_SYMBOLS[b]!.weight * SLOT_SYMBOLS[c]!.weight) / 1_000_000) * (slotsPayTenths([a, b, c]) / 10);
  return total;
}

// ---- Mines ----------------------------------------------------------------------------------------------

export const MINES_TILES = 20;
export const MINES_MIN = 1;
export const MINES_MAX = 10;
export const MINES_DEFAULT = 3;
/** Percent of the fair payout that is paid (a 3% house edge). */
export const MINES_EDGE = 97;
/** No game pays more than this many times the bet. */
export const MINES_CAP = 1000;

export function choose(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let result = 1;
  for (let index = 1; index <= k; index += 1) result = (result * (n - k + index)) / index;
  return Math.round(result);
}

/** Where the mines are: `count` distinct tiles. */
export function placeMines(count: number, rng: Rng): number[] {
  const tiles = Array.from({ length: MINES_TILES }, (_, index) => index);
  for (let index = tiles.length - 1; index > 0; index -= 1) {
    const swap = pickIndex(index + 1, rng);
    [tiles[index], tiles[swap]] = [tiles[swap]!, tiles[index]!];
  }
  return tiles.slice(0, count).sort((a, b) => a - b);
}

/** What cashing out pays after `revealed` safe tiles: the fair odds less 3%, at most 1,000 times the bet. */
export function minesPayout(bet: number, mines: number, revealed: number): number {
  if (revealed <= 0) return bet;
  const fair = choose(MINES_TILES, revealed) / choose(MINES_TILES - mines, revealed);
  return Math.min(bet * MINES_CAP, Math.floor((bet * MINES_EDGE * fair) / 100));
}

export const minesMultiplier = (mines: number, revealed: number) => minesPayout(1_000_000, mines, revealed) / 1_000_000;

// ---- Coinflip -------------------------------------------------------------------------------------------

export type Side = 'heads' | 'tails';
/** Against the house a win pays 1.95 times the bet; between two members the winner takes both bets. */
export const COINFLIP_PAYOUT_PERCENT = 195;
export const DUEL_MS = 10 * 60 * 1000;

export const flipCoin = (rng: Rng): Side => (rng() < 0.5 ? 'heads' : 'tails');
export const otherSide = (side: Side): Side => (side === 'heads' ? 'tails' : 'heads');
export const sideName = (side: Side) => (side === 'heads' ? 'Heads' : 'Tails');
export const coinflipPayout = (bet: number) => Math.floor((bet * COINFLIP_PAYOUT_PERCENT) / 100);
