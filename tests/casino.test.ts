import { describe, expect, it } from 'vitest';

// These modules read the bot's environment when they load, so give them the values they need first.
process.env.DISCORD_TOKEN ??= 'test-token';
process.env.DISCORD_CLIENT_ID ??= 'test-client';
process.env.DISCORD_GUILD_ID ??= 'test-guild';

const rules = await import('../src/casino/casinoRules.js');
const { useMemoryStateForTests } = await import('../src/database/stateStore.js');
const store = await import('../src/casino/casinoStore.js');

const {
  BAILOUT,
  DAILY_COOLDOWN_MS,
  DAILY_STREAK_WINDOW_MS,
  MAX_BET,
  MINES_CAP,
  MINES_TILES,
  MIN_BET,
  START_BALANCE,
  bailoutClaim,
  betProblem,
  blackjackDouble,
  blackjackHit,
  blackjackStand,
  canDouble,
  choose,
  coinflipPayout,
  dailyClaim,
  handValue,
  minesPayout,
  placeMines,
  slotsPayTenths,
  slotsPayout,
  slotsReturn,
  spinReel,
} = rules;
type Card = import('../src/casino/casinoRules.js').Card;
type BlackjackHand = import('../src/casino/casinoRules.js').BlackjackHand;

const card = (rank: number): Card => ({ rank, suit: 0 });
/** A hand mid-game: `next` are the cards still to come, in the order they are drawn. */
const handOf = (player: number[], dealer: number[], next: number[], bet = 100): BlackjackHand => ({
  shoe: [...next].reverse().map(card),
  player: player.map(card),
  dealer: dealer.map(card),
  bet,
  stake: bet,
  done: false,
  result: null,
  payout: 0,
});

describe('casino chips', () => {
  it('checks bets', () => {
    expect(betProblem(MIN_BET - 1, 1000)).toMatch(/smallest/);
    expect(betProblem(MAX_BET + 1, 1_000_000)).toMatch(/biggest/);
    expect(betProblem(500, 400)).toMatch(/You have/);
    expect(betProblem(400, 400)).toBeNull();
    expect(betProblem(10.5, 400)).toMatch(/smallest/);
  });

  it('pays the daily with a streak that grows to +500 and resets after 48 hours', () => {
    const start = 1_800_000_000_000;
    expect(dailyClaim(0, 0, start)).toEqual({ ok: true, streak: 1, amount: 500 });
    expect(dailyClaim(start, 1, start + DAILY_COOLDOWN_MS - 1)).toEqual({ ok: false, nextAt: start + DAILY_COOLDOWN_MS });
    expect(dailyClaim(start, 1, start + DAILY_COOLDOWN_MS)).toEqual({ ok: true, streak: 2, amount: 550 });
    expect(dailyClaim(start, 30, start + DAILY_COOLDOWN_MS)).toEqual({ ok: true, streak: 31, amount: 1000 });
    expect(dailyClaim(start, 5, start + DAILY_STREAK_WINDOW_MS + 1)).toEqual({ ok: true, streak: 1, amount: 500 });
  });

  it('gives a bailout only to a broke member with nothing in play, every 2 hours', () => {
    expect(bailoutClaim(5, 0, 0, 1000)).toEqual({ ok: true });
    expect(bailoutClaim(50, 0, 0, 1000)).toEqual({ ok: false, nextAt: null });
    expect(bailoutClaim(5, 100, 0, 1000)).toEqual({ ok: false, nextAt: null });
    expect(bailoutClaim(5, 0, 1000, 2000)).toMatchObject({ ok: false });
  });
});

describe('blackjack', () => {
  it('counts aces as 11 when they fit', () => {
    expect(handValue([card(1), card(13)])).toEqual({ total: 21, soft: true });
    expect(handValue([card(1), card(1), card(9)])).toEqual({ total: 21, soft: true });
    expect(handValue([card(1), card(13), card(5)])).toEqual({ total: 16, soft: false });
  });

  it('pays a win 1:1, a push the bet, a loss nothing', () => {
    // Player 20 against a dealer 16 who draws a 10: dealer busts.
    expect(blackjackStand(handOf([10, 10], [10, 6], [10]))).toMatchObject({ result: 'dealer-bust', payout: 200 });
    // Player 20 against a dealer 17: the dealer stands on 17.
    expect(blackjackStand(handOf([10, 10], [10, 7], [5]))).toMatchObject({ result: 'win', payout: 200 });
    expect(blackjackStand(handOf([10, 7], [10, 7], [5]))).toMatchObject({ result: 'push', payout: 100 });
    expect(blackjackStand(handOf([10, 6], [10, 8], [5]))).toMatchObject({ result: 'loss', payout: 0 });
  });

  it('stands on a soft 17', () => {
    const hand = blackjackStand(handOf([10, 8], [1, 6], [10]));
    expect(hand.dealer).toHaveLength(2);
    expect(hand.result).toBe('win');
  });

  it('busts on a hit over 21 and stands by itself on 21', () => {
    expect(blackjackHit(handOf([10, 6], [10, 7], [10]))).toMatchObject({ result: 'bust', payout: 0, done: true });
    const hand = blackjackHit(handOf([10, 6], [10, 7], [5]));
    expect(hand).toMatchObject({ result: 'win', done: true });
  });

  it('doubles the stake for exactly one card', () => {
    const hand = handOf([5, 6], [10, 7], [10, 2]);
    expect(canDouble(hand)).toBe(true);
    blackjackDouble(hand);
    expect(hand.player).toHaveLength(3);
    expect(hand).toMatchObject({ stake: 200, result: 'win', payout: 400 });
    expect(canDouble(hand)).toBe(false);
  });

  it('pays a natural blackjack 3:2', async () => {
    // Deal order: player, dealer, player, dealer. Find a shuffle that gives the player A + K.
    for (let seed = 1; seed < 2000; seed += 1) {
      let state = seed;
      const rng = () => {
        state = (state * 1103515245 + 12345) % 2147483648;
        return state / 2147483648;
      };
      const hand = rules.blackjackDeal(100, rng);
      if (hand.result === 'blackjack') {
        expect(hand.payout).toBe(250);
        expect(hand.done).toBe(true);
        return;
      }
    }
    throw new Error('No natural blackjack in 2000 shuffles');
  });
});

describe('slots', () => {
  it('pays three of a kind, any pair, or nothing', () => {
    expect(slotsPayTenths([4, 4, 4])).toBe(1000);
    expect(slotsPayTenths([0, 0, 1])).toBe(5);
    expect(slotsPayTenths([1, 0, 1])).toBe(10);
    expect(slotsPayTenths([2, 3, 3])).toBe(20);
    expect(slotsPayTenths([2, 3, 4])).toBe(0);
    expect(slotsPayout(100, [4, 4, 4])).toBe(10_000);
    expect(slotsPayout(15, [0, 0, 1])).toBe(7);
  });

  it('picks symbols by weight', () => {
    expect(spinReel(() => 0)).toBe(0);
    expect(spinReel(() => 0.35)).toBe(1);
    expect(spinReel(() => 0.999)).toBe(4);
  });

  it('gives back about 95% on average', () => {
    expect(slotsReturn()).toBeGreaterThan(0.93);
    expect(slotsReturn()).toBeLessThan(0.97);
  });
});

describe('mines', () => {
  it('pays 97% of the fair odds whenever you cash out', () => {
    expect(choose(20, 3)).toBe(1140);
    expect(minesPayout(100, 3, 1)).toBe(114);
    for (const mines of [1, 3, 5, 10]) {
      for (let revealed = 1; revealed <= Math.min(5, MINES_TILES - mines); revealed += 1) {
        const survive = choose(MINES_TILES - mines, revealed) / choose(MINES_TILES, revealed);
        const payout = minesPayout(1_000_000, mines, revealed);
        if (payout < 1_000_000 * MINES_CAP) expect((survive * payout) / 1_000_000).toBeCloseTo(0.97, 4);
      }
    }
  });

  it('never pays more than 1,000 times the bet', () => {
    expect(minesPayout(100, 10, 10)).toBe(100 * MINES_CAP);
  });

  it('places distinct mines', () => {
    const mines = placeMines(10, Math.random);
    expect(new Set(mines).size).toBe(10);
    expect(mines.every((tile) => tile >= 0 && tile < MINES_TILES)).toBe(true);
  });
});

describe('coinflip', () => {
  it('pays 1.95 times the bet against the house', () => {
    expect(coinflipPayout(100)).toBe(195);
    expect(coinflipPayout(15)).toBe(29);
  });
});

describe('casino records', () => {
  useMemoryStateForTests();

  it('holds a bet until the game pays, and never pays twice', async () => {
    const placed = await store.placeBet('100000001', 'Ace', 'g1', 300);
    expect(placed).toEqual({ ok: true, balance: START_BALANCE - 300 });
    expect(await store.settleBet('100000001', 'g1', 600)).toEqual({ balance: START_BALANCE + 300, stake: 300 });
    expect(await store.settleBet('100000001', 'g1', 600)).toBeNull();
    const player = await store.playerSnapshot('100000001', 'Ace');
    expect(player).toMatchObject({ balance: START_BALANCE + 300, games: 1, wagered: 300, biggestWin: 300, inPlay: {} });
  });

  it('refuses a bet over the balance and a fourth open game', async () => {
    expect(await store.placeBet('100000002', 'Bea', 'h1', START_BALANCE + 1)).toMatchObject({ ok: false });
    for (const id of ['h1', 'h2', 'h3']) expect(await store.placeBet('100000002', 'Bea', id, 10)).toMatchObject({ ok: true });
    expect(await store.placeBet('100000002', 'Bea', 'h4', 10)).toMatchObject({ ok: false, reason: expect.stringMatching(/3 games/) });
  });

  it('raises a bet for a double only with the chips to cover it', async () => {
    await store.placeBet('100000003', 'Cal', 'd1', 600);
    expect(await store.raiseBet('100000003', 'd1', 600)).toMatchObject({ ok: false });
    expect(await store.raiseBet('100000003', 'd1', 400)).toEqual({ ok: true, balance: 0 });
    expect(await store.settleBet('100000003', 'd1', 2000)).toEqual({ balance: 2000, stake: 1000 });
  });

  it('refunds a declined duel and every bet held at startup', async () => {
    await store.placeBet('100000004', 'Dee', 'x1', 200);
    expect(await store.refundBet('100000004', 'x1')).toEqual({ balance: START_BALANCE, stake: 200 });
    await store.placeBet('100000004', 'Dee', 'x2', 100);
    await store.placeBet('100000005', 'Eve', 'x3', 50);
    expect(await store.refundEverything()).toBeGreaterThanOrEqual(2);
    expect((await store.playerSnapshot('100000004', 'Dee')).balance).toBe(START_BALANCE);
    expect((await store.playerSnapshot('100000005', 'Eve')).inPlay).toEqual({});
  });

  it('claims the daily once, then a bailout only when broke', async () => {
    expect(await store.claimChips('100000006', 'Fay')).toMatchObject({ kind: 'daily', amount: 500, balance: START_BALANCE + 500 });
    expect(await store.claimChips('100000006', 'Fay')).toMatchObject({ kind: 'wait' });
    await store.withCasino((casino) => {
      casino['100000006']!.balance = 0;
    });
    expect(await store.claimChips('100000006', 'Fay')).toMatchObject({ kind: 'bailout', amount: BAILOUT, balance: BAILOUT });
    expect(await store.claimChips('100000006', 'Fay')).toMatchObject({ kind: 'wait' });
  });
});
