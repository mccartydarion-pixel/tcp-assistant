import { randomInt } from 'node:crypto';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  SlashCommandBuilder,
  escapeMarkdown,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type EmbedBuilder,
  type Guild,
  type Interaction,
  type Message,
  type SlashCommandIntegerOption,
} from 'discord.js';
import { env } from '../config/env.js';
import { notice, tcpEmbed, type Tone } from '../bot/embeds.js';
import { logger } from '../utils/logger.js';
import {
  DUEL_MS,
  MAX_BET,
  MINES_DEFAULT,
  MINES_MAX,
  MINES_MIN,
  MINES_TILES,
  MIN_BET,
  SLOT_SYMBOLS,
  START_BALANCE,
  blackjackDeal,
  blackjackDouble,
  blackjackHit,
  blackjackStand,
  canDouble,
  cardText,
  chips,
  coinflipPayout,
  dailyClaim,
  flipCoin,
  fmt,
  handValue,
  minesMultiplier,
  minesPayout,
  otherSide,
  placeMines,
  sideName,
  slotsPayout,
  slotsReturn,
  spinReel,
  spinSlots,
  type BlackjackHand,
  type Card,
  type Rng,
  type Side,
} from './casinoRules.js';
import {
  claimChips,
  inPlayTotal,
  placeBet,
  playerSnapshot,
  raiseBet,
  readCasino,
  readCasinoPlayer,
  refundBet,
  refundEverything,
  settleBet,
  type Casino,
  type CasinoPlayer,
} from './casinoStore.js';

// The T.C.P casino (/casino): Blackjack, Slots, Mines and Coinflip (against the house or a member) for free
// play-money chips. Games run only in a channel with "casino" in its name (the owner can test anywhere).
// Hidden things (the cards, where the mines are) stay in the bot's memory, never in the buttons; a game's
// bet is held in the records until it ends, and a restart refunds it. A game left alone for 5 minutes is
// finished for the player (Blackjack stands, Mines cashes out or refunds), and a duel nobody accepts expires.

const PREFIX = 'tcp-cas:';
const PAYTABLE_ID = `${PREFIX}paytable`;
const IDLE_MS = 5 * 60 * 1000;
const SWEEP_MS = 60 * 1000;
const PLAY_MONEY = 'Play money only: chips can never be bought, sold, traded or swapped for anything real.';
const STORE_DOWN = 'The casino cannot reach its records right now, so nothing was bet. Try again in a minute.';
const MEDALS = ['🥇', '🥈', '🥉'];

const random: Rng = () => randomInt(0, 2 ** 32) / 2 ** 32;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const seconds = (ms: number) => Math.floor(ms / 1000);
const newGameId = () => randomInt(0, 2 ** 40).toString(36);

interface View {
  content?: string;
  embeds: EmbedBuilder[];
  components: ActionRowBuilder<ButtonBuilder>[];
  allowedMentions?: { users: string[] };
}

interface GameBase {
  id: string;
  userId: string;
  message: Message | null;
  touched: number;
  busy: boolean;
}
interface BlackjackGame extends GameBase {
  kind: 'bj';
  hand: BlackjackHand;
}
interface MinesGame extends GameBase {
  kind: 'mn';
  bet: number;
  count: number;
  mines: number[];
  revealed: number[];
  hit: number | null;
}
interface DuelGame extends GameBase {
  kind: 'du';
  opponentId: string;
  bet: number;
  side: Side;
  created: number;
}
type Game = BlackjackGame | MinesGame | DuelGame;

const games = new Map<string, Game>();

const button = (id: string, label: string, style: ButtonStyle, disabled = false) =>
  new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style).setDisabled(disabled);
const row = (...buttons: ButtonBuilder[]) => new ActionRowBuilder<ButtonBuilder>().addComponents(buttons);
const gameId = (game: Game, action: string) => `${PREFIX}${game.kind}:${game.id}:${game.userId}:${action}`;
const againId = (userId: string, kind: 'bj' | 'sl' | 'mn' | 'cf', bet: number, extra = '') => `${PREFIX}again:${userId}:${kind}:${bet}:${extra}`;

async function stored<T>(work: Promise<T>): Promise<T | null> {
  try {
    return await work;
  } catch (error) {
    logger.warn({ err: error }, '[TCP Casino] The records could not be read or saved');
    return null;
  }
}

function casinoChannelId(guild: Guild | null): string | null {
  const channel = guild?.channels.cache.find((candidate) => candidate.type === ChannelType.GuildText && candidate.name.toLowerCase().includes('casino'));
  return channel?.id ?? null;
}

/** Games run in the casino channel; the owner can test anywhere. */
function wherePlayProblem(interaction: ChatInputCommandInteraction): string | null {
  const casinoId = casinoChannelId(interaction.guild);
  if (casinoId && interaction.channelId === casinoId) return null;
  if (env.OWNER_USER_ID && interaction.user.id === env.OWNER_USER_ID) return null;
  return casinoId ? `The casino is in <#${casinoId}>. Play there.` : 'The casino is not open yet.';
}

async function nameOf(interaction: Interaction, userId: string): Promise<string> {
  const member = interaction.guild ? await interaction.guild.members.fetch(userId).catch(() => null) : null;
  if (member) return member.displayName;
  const user = interaction.user.id === userId ? interaction.user : await interaction.client.users.fetch(userId).catch(() => null);
  return user?.displayName ?? 'Unknown player';
}

const tell = (interaction: ButtonInteraction, text: string) => interaction.reply({ ...notice(text), ephemeral: true });

// Where a game draws itself: a slash command's reply, or the message whose button was pressed.
interface Screen {
  show(view: View): Promise<Message>;
  fail(text: string): Promise<void>;
}

function commandScreen(interaction: ChatInputCommandInteraction): Screen {
  return {
    async show(view) {
      if (interaction.replied || interaction.deferred) return interaction.editReply(view);
      await interaction.reply(view);
      return interaction.fetchReply();
    },
    async fail(text) {
      const payload = { ...notice(text, { tone: 'danger' }), ephemeral: true };
      if (interaction.replied || interaction.deferred) await interaction.followUp(payload);
      else await interaction.reply(payload);
    },
  };
}

/** For a button press already acknowledged with deferUpdate. */
function buttonScreen(interaction: ButtonInteraction): Screen {
  return {
    show: (view) => interaction.editReply(view),
    async fail(text) {
      await interaction.followUp({ ...notice(text, { tone: 'danger' }), ephemeral: true });
    },
  };
}

function resultTone(payout: number, stake: number): Tone {
  return payout > stake ? 'success' : payout === stake ? 'muted' : 'danger';
}

const balanceLine = (balance: number | null | undefined) => (balance === null || balance === undefined ? [] : [`Balance: **${chips(balance)}**`]);

// ---- Blackjack ---------------------------------------------------------------------------------------

const handText = (cards: Card[]) => cards.map(cardText).join('  ');
function valueText(cards: Card[]): string {
  const value = handValue(cards);
  if (cards.length === 2 && value.total === 21) return 'Blackjack';
  return value.soft ? `soft ${value.total}` : `${value.total}`;
}

function blackjackResultText(hand: BlackjackHand): string {
  const net = hand.payout - hand.stake;
  switch (hand.result) {
    case 'blackjack':
      return `🃏 **Blackjack!** You win ${chips(net)}.`;
    case 'win':
      return `🏆 **You win** ${chips(net)}.`;
    case 'dealer-bust':
      return `💥 **Dealer busts.** You win ${chips(net)}.`;
    case 'push':
      return '🤝 **Push.** Your bet is back.';
    case 'bust':
      return `💥 **Bust.** You lose ${chips(hand.stake)}.`;
    case 'dealer-blackjack':
      return `🃏 **Dealer has blackjack.** You lose ${chips(hand.stake)}.`;
    default:
      return `🤖 **Dealer wins.** You lose ${chips(hand.stake)}.`;
  }
}

function blackjackView(game: BlackjackGame, balance?: number | null, note?: string): View {
  const { hand } = game;
  const lines = [`<@${game.userId}> · bet ${chips(hand.stake)}${hand.stake > hand.bet ? ' (doubled)' : ''}`];
  if (hand.done) lines.push('', blackjackResultText(hand), ...(note ? [note] : []), ...balanceLine(balance));
  const dealerCards = hand.done ? hand.dealer : hand.dealer.slice(0, 1);
  const components = hand.done
    ? [row(button(againId(game.userId, 'bj', hand.bet), `Deal again (${chips(hand.bet)})`, ButtonStyle.Primary))]
    : [
        row(
          button(gameId(game, 'hit'), 'Hit', ButtonStyle.Primary),
          button(gameId(game, 'stand'), 'Stand', ButtonStyle.Secondary),
          button(gameId(game, 'double'), 'Double', ButtonStyle.Success, !canDouble(hand)),
        ),
      ];
  return {
    embeds: [
      tcpEmbed({
        title: '🃏 Blackjack',
        description: lines.join('\n'),
        tone: hand.done ? resultTone(hand.payout, hand.stake) : 'brand',
        fields: [
          { name: `Dealer · ${hand.done ? valueText(hand.dealer) : `${handValue(dealerCards).total} showing`}`, value: hand.done ? handText(hand.dealer) : `${handText(dealerCards)}  🂠`, inline: true },
          { name: `You · ${valueText(hand.player)}`, value: handText(hand.player), inline: true },
        ],
      }),
    ],
    components,
  };
}

async function startBlackjack(screen: Screen, userId: string, name: string, bet: number): Promise<void> {
  const id = newGameId();
  const placed = await stored(placeBet(userId, name, id, bet));
  if (!placed) return screen.fail(STORE_DOWN);
  if (!placed.ok) return screen.fail(placed.reason);
  const game: BlackjackGame = { kind: 'bj', id, userId, message: null, touched: Date.now(), busy: false, hand: blackjackDeal(bet, random) };
  if (game.hand.done) {
    const settled = await stored(settleBet(userId, id, game.hand.payout));
    await screen.show(blackjackView(game, settled?.balance));
    return;
  }
  games.set(id, game);
  game.message = await screen.show(blackjackView(game));
}

async function blackjackAction(screen: Screen, game: BlackjackGame, action: string): Promise<void> {
  const { hand } = game;
  if (action === 'double') {
    if (!canDouble(hand)) return;
    const raised = await stored(raiseBet(game.userId, game.id, hand.bet));
    if (!raised) return screen.fail(STORE_DOWN);
    if (!raised.ok) return screen.fail(raised.reason);
    blackjackDouble(hand);
  } else if (action === 'hit') blackjackHit(hand);
  else if (action === 'stand') blackjackStand(hand);
  else return;

  if (!hand.done) {
    await screen.show(blackjackView(game));
    return;
  }
  games.delete(game.id);
  const settled = await stored(settleBet(game.userId, game.id, hand.payout));
  await screen.show(blackjackView(game, settled?.balance));
}

// ---- Slots -------------------------------------------------------------------------------------------

const reelsText = (reels: readonly number[]) => `> ${reels.map((index) => SLOT_SYMBOLS[index]!.emoji).join('  ┃  ')}`;

function slotsResultText(reels: readonly number[], bet: number, payout: number): string {
  const [a, b, c] = reels as [number, number, number];
  if (a === b && b === c) {
    const symbol = SLOT_SYMBOLS[a]!;
    return symbol.emoji === '🎯' ? `💎 **JACKPOT!** Three T.C.P: you win ${chips(payout - bet)}!` : `🎉 **Three ${symbol.name}!** You win ${chips(payout - bet)}.`;
  }
  if (payout > 0) {
    const paired = SLOT_SYMBOLS[a === b || a === c ? a : b]!.emoji;
    if (payout > bet) return `Two ${paired}: you win ${chips(payout - bet)}.`;
    if (payout === bet) return `Two ${paired}: your bet is back.`;
    return `Two ${paired}: ${chips(payout)} back.`;
  }
  return `Nothing this time. You lose ${chips(bet)}.`;
}

function slotsView(userId: string, bet: number, reels: readonly number[], result: { payout: number; balance: number | null | undefined } | null): View {
  const lines = [`<@${userId}> · bet ${chips(bet)}`, '', reelsText(reels), ''];
  if (result) lines.push(slotsResultText(reels, bet, result.payout), ...balanceLine(result.balance));
  else lines.push('Spinning…');
  return {
    embeds: [tcpEmbed({ title: '🎰 Slots', description: lines.join('\n'), tone: result ? resultTone(result.payout, bet) : 'brand' })],
    components: result
      ? [row(button(againId(userId, 'sl', bet), `Spin again (${chips(bet)})`, ButtonStyle.Primary), button(PAYTABLE_ID, 'Paytable', ButtonStyle.Secondary))]
      : [],
  };
}

function paytableView(): View {
  const lines = SLOT_SYMBOLS.slice()
    .reverse()
    .map((symbol) => `${symbol.emoji}${symbol.emoji}${symbol.emoji} **${symbol.three / 10}×** · any two ${symbol.emoji} **${symbol.two / 10}×**`);
  return {
    embeds: [
      tcpEmbed({
        title: '🎰 Slots paytable',
        description: [
          ...lines,
          '',
          'Paid on your bet, stake included. Three of a kind pays the line; otherwise any two of the same pay the pair.',
          `About **${Math.round(slotsReturn() * 100)}%** of every bet comes back on average.`,
        ].join('\n'),
        footer: PLAY_MONEY,
      }),
    ],
    components: [],
  };
}

async function playSlots(screen: Screen, userId: string, name: string, bet: number): Promise<void> {
  const id = newGameId();
  const placed = await stored(placeBet(userId, name, id, bet));
  if (!placed) return screen.fail(STORE_DOWN);
  if (!placed.ok) return screen.fail(placed.reason);
  // The spin is decided and paid first; the animation only shows it.
  const reels = spinSlots(random);
  const payout = slotsPayout(bet, reels);
  const settled = await stored(settleBet(userId, id, payout));
  await screen.show(slotsView(userId, bet, spinSlots(random), null));
  await sleep(700);
  await screen.show(slotsView(userId, bet, [reels[0], spinReel(random), spinReel(random)], null));
  await sleep(700);
  await screen.show(slotsView(userId, bet, reels, { payout, balance: settled?.balance }));
}

// ---- Mines -------------------------------------------------------------------------------------------

type MinesEnding = 'boom' | 'cashed' | 'cleared' | 'refunded';

function minesView(game: MinesGame, ending: MinesEnding | null, balance?: number | null, note?: string): View {
  const found = game.revealed.length;
  const payout = minesPayout(game.bet, game.count, found);
  const lines = [`<@${game.userId}> · bet ${chips(game.bet)} · 💣 ${game.count} mine${game.count === 1 ? '' : 's'}`];
  if (ending === null) {
    lines.push(
      found === 0
        ? `Pick a tile. The first safe one pays ${minesMultiplier(game.count, 1).toFixed(2)}×.`
        : `Safe tiles: **${found}** · cash out now **${chips(payout)}** (${minesMultiplier(game.count, found).toFixed(2)}×) · next tile **${minesMultiplier(game.count, found + 1).toFixed(2)}×**`,
    );
  } else {
    lines.push('');
    if (ending === 'boom') lines.push(`💥 **Boom.** You lose ${chips(game.bet)}.`);
    else if (ending === 'refunded') lines.push('Nothing was picked in 5 minutes, so your bet is back.');
    else lines.push(`${ending === 'cleared' ? '🏆 **Every safe tile found!**' : '💰 **Cashed out.**'} ${chips(payout)} (${minesMultiplier(game.count, found).toFixed(2)}×), you win ${chips(payout - game.bet)}.`);
    if (note) lines.push(note);
    lines.push(...balanceLine(balance));
  }

  const over = ending !== null;
  const rows = [0, 1, 2, 3].map((rowIndex) =>
    row(
      ...[0, 1, 2, 3, 4].map((column) => {
        const tile = rowIndex * 5 + column;
        const tileButton = new ButtonBuilder().setCustomId(gameId(game, `t${tile}`));
        if (game.revealed.includes(tile)) return tileButton.setEmoji('💎').setStyle(ButtonStyle.Success).setDisabled(true);
        if (over && game.mines.includes(tile)) return tileButton.setEmoji(tile === game.hit ? '💥' : '💣').setStyle(ButtonStyle.Danger).setDisabled(true);
        return tileButton.setLabel('​').setStyle(ButtonStyle.Secondary).setDisabled(over);
      }),
    ),
  );
  const controls = over
    ? row(button(againId(game.userId, 'mn', game.bet, String(game.count)), `Play again (${chips(game.bet)})`, ButtonStyle.Primary))
    : row(button(gameId(game, 'cash'), found === 0 ? 'Cash out' : `Cash out ${chips(payout)}`, ButtonStyle.Success, found === 0));
  return {
    embeds: [
      tcpEmbed({
        title: '💣 Mines',
        description: lines.join('\n'),
        tone: ending === null ? 'brand' : ending === 'boom' ? 'danger' : ending === 'refunded' ? 'muted' : 'success',
      }),
    ],
    components: [...rows, controls],
  };
}

async function startMines(screen: Screen, userId: string, name: string, bet: number, count: number): Promise<void> {
  const mines = Math.min(MINES_MAX, Math.max(MINES_MIN, Math.floor(count) || MINES_DEFAULT));
  const id = newGameId();
  const placed = await stored(placeBet(userId, name, id, bet));
  if (!placed) return screen.fail(STORE_DOWN);
  if (!placed.ok) return screen.fail(placed.reason);
  const game: MinesGame = { kind: 'mn', id, userId, message: null, touched: Date.now(), busy: false, bet, count: mines, mines: placeMines(mines, random), revealed: [], hit: null };
  games.set(id, game);
  game.message = await screen.show(minesView(game, null));
}

async function minesAction(screen: Screen, game: MinesGame, action: string): Promise<void> {
  if (action === 'cash') {
    if (game.revealed.length === 0) return;
    games.delete(game.id);
    const settled = await stored(settleBet(game.userId, game.id, minesPayout(game.bet, game.count, game.revealed.length)));
    await screen.show(minesView(game, 'cashed', settled?.balance));
    return;
  }
  const tile = Number(action.slice(1));
  if (!action.startsWith('t') || !Number.isInteger(tile) || tile < 0 || tile >= MINES_TILES || game.revealed.includes(tile)) return;
  if (game.mines.includes(tile)) {
    game.hit = tile;
    games.delete(game.id);
    const settled = await stored(settleBet(game.userId, game.id, 0));
    await screen.show(minesView(game, 'boom', settled?.balance));
    return;
  }
  game.revealed.push(tile);
  if (game.revealed.length === MINES_TILES - game.count) {
    games.delete(game.id);
    const settled = await stored(settleBet(game.userId, game.id, minesPayout(game.bet, game.count, game.revealed.length)));
    await screen.show(minesView(game, 'cleared', settled?.balance));
    return;
  }
  await screen.show(minesView(game, null));
}

// ---- Coinflip ------------------------------------------------------------------------------------------

function coinflipView(userId: string, bet: number, side: Side, result: { landed: Side; payout: number; balance: number | null | undefined } | null): View {
  const lines = [`<@${userId}> bets ${chips(bet)} on **${sideName(side)}**.`, ''];
  if (!result) lines.push('Flipping… 🪙');
  else {
    lines.push(
      result.payout > 0 ? `It's **${sideName(result.landed)}**! You win ${chips(result.payout - bet)}.` : `It's **${sideName(result.landed)}**. You lose ${chips(bet)}.`,
      ...balanceLine(result.balance),
    );
  }
  return {
    embeds: [tcpEmbed({ title: '🪙 Coinflip', description: lines.join('\n'), tone: result ? resultTone(result.payout, bet) : 'brand' })],
    components: result
      ? [
          row(
            button(againId(userId, 'cf', bet, 'heads'), `Heads again (${chips(bet)})`, side === 'heads' ? ButtonStyle.Primary : ButtonStyle.Secondary),
            button(againId(userId, 'cf', bet, 'tails'), `Tails (${chips(bet)})`, side === 'tails' ? ButtonStyle.Primary : ButtonStyle.Secondary),
          ),
        ]
      : [],
  };
}

async function playCoinflip(screen: Screen, userId: string, name: string, bet: number, side: Side): Promise<void> {
  const id = newGameId();
  const placed = await stored(placeBet(userId, name, id, bet));
  if (!placed) return screen.fail(STORE_DOWN);
  if (!placed.ok) return screen.fail(placed.reason);
  const landed = flipCoin(random);
  const payout = landed === side ? coinflipPayout(bet) : 0;
  const settled = await stored(settleBet(userId, id, payout));
  await screen.show(coinflipView(userId, bet, side, null));
  await sleep(1000);
  await screen.show(coinflipView(userId, bet, side, { landed, payout, balance: settled?.balance }));
}

type DuelState = 'open' | 'declined' | 'withdrawn' | 'expired' | 'done';

function duelView(game: DuelGame, state: DuelState, landed?: Side): View {
  const { userId, opponentId, bet, side } = game;
  if (state === 'open') {
    return {
      content: `<@${opponentId}>`,
      allowedMentions: { users: [opponentId] },
      embeds: [
        tcpEmbed({
          title: '⚔️ Coinflip duel',
          description: [
            `<@${userId}> bets ${chips(bet)} on **${sideName(side)}** against <@${opponentId}>.`,
            `<@${opponentId}> takes **${sideName(otherSide(side))}**: accept to match the bet. The winner takes ${chips(bet * 2)}.`,
            '',
            `Expires <t:${seconds(game.created + DUEL_MS)}:R>.`,
          ].join('\n'),
        }),
      ],
      components: [
        row(
          button(gameId(game, 'accept'), `Accept (${chips(bet)})`, ButtonStyle.Success),
          button(gameId(game, 'decline'), 'Decline', ButtonStyle.Danger),
          button(gameId(game, 'withdraw'), 'Withdraw', ButtonStyle.Secondary),
        ),
      ],
    };
  }
  let text: string;
  if (state === 'done' && landed) {
    const winnerId = landed === side ? userId : opponentId;
    text = `<@${userId}> (${sideName(side)}) vs <@${opponentId}> (${sideName(otherSide(side))}) for ${chips(bet)} each.\n\nIt's **${sideName(landed)}**! 🏆 <@${winnerId}> wins ${chips(bet * 2)}.`;
  } else if (state === 'declined') text = `<@${opponentId}> declined the duel. <@${userId}>'s ${chips(bet)} is back.`;
  else if (state === 'withdrawn') text = `<@${userId}> withdrew the duel and has the ${chips(bet)} back.`;
  else text = `Nobody accepted in time. <@${userId}>'s ${chips(bet)} is back.`;
  return { content: '', embeds: [tcpEmbed({ title: '⚔️ Coinflip duel', description: text, tone: state === 'done' ? 'success' : 'muted' })], components: [] };
}

async function startDuel(screen: Screen, userId: string, name: string, opponentId: string, bet: number, side: Side): Promise<void> {
  const id = newGameId();
  const placed = await stored(placeBet(userId, name, id, bet));
  if (!placed) return screen.fail(STORE_DOWN);
  if (!placed.ok) return screen.fail(placed.reason);
  const game: DuelGame = { kind: 'du', id, userId, opponentId, bet, side, created: Date.now(), message: null, touched: Date.now(), busy: false };
  games.set(id, game);
  game.message = await screen.show(duelView(game, 'open'));
}

async function duelAction(interaction: ButtonInteraction, game: DuelGame, action: string): Promise<void> {
  const screen = buttonScreen(interaction);
  if (action === 'decline' || action === 'withdraw') {
    games.delete(game.id);
    await stored(refundBet(game.userId, game.id));
    await screen.show(duelView(game, action === 'decline' ? 'declined' : 'withdrawn'));
    return;
  }
  if (action !== 'accept') return;
  if (Date.now() > game.created + DUEL_MS) {
    games.delete(game.id);
    await stored(refundBet(game.userId, game.id));
    await screen.show(duelView(game, 'expired'));
    return;
  }
  const placed = await stored(placeBet(game.opponentId, await nameOf(interaction, game.opponentId), game.id, game.bet));
  if (!placed) return screen.fail(STORE_DOWN);
  if (!placed.ok) return screen.fail(`You need ${chips(game.bet)} to accept. ${placed.reason}`);
  games.delete(game.id);
  const landed = flipCoin(random);
  const challengerWins = landed === game.side;
  await stored(settleBet(game.userId, game.id, challengerWins ? game.bet * 2 : 0));
  await stored(settleBet(game.opponentId, game.id, challengerWins ? 0 : game.bet * 2));
  await screen.show(duelView(game, 'done', landed));
}

// ---- balance, daily and the leaderboard --------------------------------------------------------------

interface Ranked extends CasinoPlayer {
  id: string;
}

function ranking(casino: Casino): Ranked[] {
  return Object.entries(casino)
    .map(([id, entry]) => ({ id, ...readCasinoPlayer(entry) }))
    .filter((player) => player.games > 0 || player.lastDaily > 0)
    .sort((a, b) => b.balance - a.balance || b.paidOut - a.paidOut || a.name.localeCompare(b.name));
}

function balanceView(player: CasinoPlayer, place: string | null): View {
  const daily = dailyClaim(player.lastDaily, player.streak, Date.now());
  const held = inPlayTotal(player);
  const lines = [
    `Balance: **${chips(player.balance)}**${held > 0 ? ` · in play ${chips(held)}` : ''}`,
    `Daily: ${daily.ok ? '**ready**, `/casino daily`' : `<t:${seconds(daily.nextAt)}:R>`}${player.streak > 1 ? ` · streak **${player.streak}** days` : ''}`,
    ...(place ? [`Place: ${place}`] : []),
    `Games **${fmt(player.games)}** · wagered ${chips(player.wagered)} · biggest win ${chips(player.biggestWin)}`,
  ];
  return { embeds: [tcpEmbed({ title: '🪙 Your chips', description: lines.join('\n'), footer: PLAY_MONEY })], components: [] };
}

function leaderboardView(casino: Casino, viewerId: string): View {
  const ranked = ranking(casino);
  const line = (player: Ranked, index: number) => `${MEDALS[index] ?? `**${index + 1}.**`} ${escapeMarkdown(player.name.slice(0, 32))} · ${chips(player.balance)}`;
  const biggest = [...ranked].filter((player) => player.biggestWin > 0).sort((a, b) => b.biggestWin - a.biggestWin).slice(0, 3);
  const mine = ranked.findIndex((player) => player.id === viewerId);
  return {
    embeds: [
      tcpEmbed({
        title: '🏆 Casino leaderboard',
        description: mine >= 0 ? `**You:** #${mine + 1} of ${ranked.length} · ${chips(ranked[mine]!.balance)}` : `Everyone starts with ${chips(START_BALANCE)}. \`/casino daily\` for more.`,
        fields: [
          { name: '💰 Richest', value: ranked.slice(0, 10).map(line).join('\n') || 'Nobody has played yet.' },
          { name: '💥 Biggest single wins', value: biggest.map((player, index) => `${MEDALS[index]} ${escapeMarkdown(player.name.slice(0, 32))} · +${chips(player.biggestWin)}`).join('\n') || 'None yet.' },
        ],
        footer: PLAY_MONEY,
      }),
    ],
    components: [],
  };
}

// ---- the command ---------------------------------------------------------------------------------------

const betOption = (option: SlashCommandIntegerOption) =>
  option.setName('bet').setDescription(`Chips to bet (${MIN_BET} to ${fmt(MAX_BET)})`).setRequired(true).setMinValue(MIN_BET).setMaxValue(MAX_BET);

export function casinoCommandData() {
  return new SlashCommandBuilder()
    .setName('casino')
    .setDescription('The T.C.P casino: free play-money chips, nothing real to win or lose')
    .addSubcommand((command) => command.setName('balance').setDescription('Your chips, your daily claim and your place'))
    .addSubcommand((command) => command.setName('daily').setDescription('Claim your free daily chips (a bailout when you are broke)'))
    .addSubcommand((command) => command.setName('leaderboard').setDescription('The richest players and the biggest wins'))
    .addSubcommand((command) => command.setName('blackjack').setDescription('Blackjack against the dealer (blackjack pays 3:2)').addIntegerOption(betOption))
    .addSubcommand((command) => command.setName('slots').setDescription('Spin the T.C.P slots').addIntegerOption(betOption))
    .addSubcommand((command) =>
      command
        .setName('mines')
        .setDescription('Find safe tiles and cash out before you hit a mine')
        .addIntegerOption(betOption)
        .addIntegerOption((option) =>
          option.setName('mines').setDescription(`How many mines (${MINES_MIN} to ${MINES_MAX}, default ${MINES_DEFAULT}): more mines, bigger payouts`).setMinValue(MINES_MIN).setMaxValue(MINES_MAX),
        ),
    )
    .addSubcommand((command) =>
      command
        .setName('coinflip')
        .setDescription('Heads or tails, against the house (pays 1.95x) or a member (winner takes both bets)')
        .addIntegerOption(betOption)
        .addStringOption((option) =>
          option.setName('side').setDescription('Your side').setRequired(true).addChoices({ name: 'Heads', value: 'heads' }, { name: 'Tails', value: 'tails' }),
        )
        .addUserOption((option) => option.setName('opponent').setDescription('Bet against this member instead of the house')),
    );
}

export async function handleCasinoCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const subcommand = interaction.options.getSubcommand();
  const userId = interaction.user.id;
  const name = await nameOf(interaction, userId);
  const inCasino = casinoChannelId(interaction.guild) === interaction.channelId;

  if (subcommand === 'balance') {
    const player = await stored(playerSnapshot(userId, name));
    if (!player) {
      await interaction.reply({ ...notice(STORE_DOWN, { tone: 'danger' }), ephemeral: true });
      return;
    }
    const casino = await stored(readCasino());
    const ranked = casino ? ranking(casino) : [];
    const index = ranked.findIndex((entry) => entry.id === userId);
    await interaction.reply({ ...balanceView(player, index >= 0 ? `#${index + 1} of ${ranked.length}` : null), ephemeral: true });
    return;
  }

  if (subcommand === 'daily') {
    const claim = await stored(claimChips(userId, name));
    let text: string;
    if (!claim) text = STORE_DOWN;
    else if (claim.kind === 'daily')
      text = [
        `🪙 **+${fmt(claim.amount)} chips**${claim.streak > 1 ? ` · day **${claim.streak}** in a row` : ''}`,
        `Balance: **${chips(claim.balance)}**`,
        '',
        `Next claim <t:${seconds(claim.nextAt)}:R>. Claim again within 48 hours to keep the streak (up to +500 a day).`,
      ].join('\n');
    else if (claim.kind === 'bailout') text = `🆘 **Bailout: +${fmt(claim.amount)} chips.** Balance: **${chips(claim.balance)}**\n\nYour daily is back <t:${seconds(claim.nextDailyAt)}:R>.`;
    else
      text = [
        `Your next daily is <t:${seconds(claim.nextDailyAt)}:R>. Balance: **${chips(claim.balance)}**`,
        ...(claim.nextBailoutAt ? [`Broke? A bailout is ready <t:${seconds(claim.nextBailoutAt)}:R>.`] : []),
      ].join('\n');
    await interaction.reply({ ...notice(text, { tone: claim?.kind === 'wait' || !claim ? 'muted' : 'success', footer: PLAY_MONEY }), ephemeral: true });
    return;
  }

  if (subcommand === 'leaderboard') {
    const casino = await stored(readCasino());
    if (!casino) {
      await interaction.reply({ ...notice(STORE_DOWN, { tone: 'danger' }), ephemeral: true });
      return;
    }
    await interaction.reply({ ...leaderboardView(casino, userId), ephemeral: !inCasino });
    return;
  }

  const problem = wherePlayProblem(interaction);
  if (problem) {
    await interaction.reply({ ...notice(problem), ephemeral: true });
    return;
  }
  const bet = interaction.options.getInteger('bet', true);
  const screen = commandScreen(interaction);
  if (subcommand === 'blackjack') return startBlackjack(screen, userId, name, bet);
  if (subcommand === 'slots') return playSlots(screen, userId, name, bet);
  if (subcommand === 'mines') return startMines(screen, userId, name, bet, interaction.options.getInteger('mines') ?? MINES_DEFAULT);
  if (subcommand === 'coinflip') {
    const side: Side = interaction.options.getString('side', true) === 'tails' ? 'tails' : 'heads';
    const opponent = interaction.options.getUser('opponent');
    if (!opponent || opponent.id === interaction.client.user.id) return playCoinflip(screen, userId, name, bet, side);
    if (opponent.id === userId) return screen.fail('You cannot duel yourself. Leave **opponent** empty to flip against the house.');
    if (opponent.bot) return screen.fail('Bots cannot play. Duel a member, or leave **opponent** empty to flip against the house.');
    return startDuel(screen, userId, name, opponent.id, bet, side);
  }
}

// ---- buttons -------------------------------------------------------------------------------------------

// "Play again" pressed twice before the message redrew would start two games: only the first counts.
const againPressed = new Map<string, number>();
function firstAgain(interaction: ButtonInteraction): boolean {
  const now = Date.now();
  if (againPressed.size > 200) for (const [key, at] of againPressed) if (now - at > 5000) againPressed.delete(key);
  const key = `${interaction.message.id}:${interaction.message.editedTimestamp ?? interaction.message.createdTimestamp}`;
  const seen = againPressed.get(key);
  if (seen !== undefined && now - seen < 5000) return false;
  againPressed.set(key, now);
  return true;
}

async function handleAgain(interaction: ButtonInteraction, parts: string[]): Promise<void> {
  const [, ownerId, kind, betText, extra] = parts;
  if (interaction.user.id !== ownerId) {
    await tell(interaction, `That button is <@${ownerId}>'s. Start your own game with \`/casino\`.`);
    return;
  }
  if (!firstAgain(interaction)) {
    await interaction.deferUpdate();
    return;
  }
  const bet = Number(betText);
  await interaction.deferUpdate();
  const screen = buttonScreen(interaction);
  const name = await nameOf(interaction, interaction.user.id);
  if (kind === 'bj') await startBlackjack(screen, interaction.user.id, name, bet);
  else if (kind === 'sl') await playSlots(screen, interaction.user.id, name, bet);
  else if (kind === 'mn') await startMines(screen, interaction.user.id, name, bet, Number(extra));
  else if (kind === 'cf') await playCoinflip(screen, interaction.user.id, name, bet, extra === 'tails' ? 'tails' : 'heads');
}

export async function handleCasinoInteraction(interaction: Interaction): Promise<boolean> {
  if (!interaction.isButton() || !interaction.customId.startsWith(PREFIX)) return false;
  const parts = interaction.customId.slice(PREFIX.length).split(':');

  if (parts[0] === 'paytable') {
    await interaction.reply({ ...paytableView(), ephemeral: true });
    return true;
  }
  if (parts[0] === 'again') {
    await handleAgain(interaction, parts);
    return true;
  }

  const [kind, id, ownerId, action = ''] = parts;
  const game = id ? games.get(id) : undefined;
  const userId = interaction.user.id;

  if (kind === 'du') {
    const duel = game?.kind === 'du' ? game : undefined;
    const opponentId = duel?.opponentId;
    if (!duel) {
      await interaction.update({ content: '', components: [] });
      await interaction.followUp({ ...notice('This duel ended when the bot restarted, and the bet went back.'), ephemeral: true });
      return true;
    }
    const allowed = action === 'withdraw' ? userId === duel.userId : userId === opponentId;
    if (!allowed) {
      await tell(
        interaction,
        userId === duel.userId
          ? `Waiting for <@${opponentId}> to answer. Press **Withdraw** to call it off.`
          : userId === opponentId
            ? `Only <@${duel.userId}> can withdraw it. Accept or decline.`
            : `This duel is between <@${duel.userId}> and <@${opponentId}>. Start your own with \`/casino coinflip opponent:\`.`,
      );
      return true;
    }
    if (duel.busy) {
      await interaction.deferUpdate();
      return true;
    }
    duel.busy = true;
    try {
      await interaction.deferUpdate();
      await duelAction(interaction, duel, action);
    } finally {
      duel.busy = false;
    }
    return true;
  }

  if (userId !== ownerId) {
    await tell(interaction, `This is <@${ownerId}>'s game. Start your own with \`/casino\`.`);
    return true;
  }
  if (!game || game.kind !== kind) {
    await interaction.update({ components: [] });
    await interaction.followUp({ ...notice('This game ended when the bot restarted, and your bet went back to you.'), ephemeral: true });
    return true;
  }
  if (game.busy) {
    await interaction.deferUpdate();
    return true;
  }
  game.busy = true;
  game.touched = Date.now();
  try {
    await interaction.deferUpdate();
    const screen = buttonScreen(interaction);
    if (game.kind === 'bj') await blackjackAction(screen, game, action);
    else if (game.kind === 'mn') await minesAction(screen, game, action);
  } finally {
    game.busy = false;
  }
  return true;
}

// ---- startup and the sweep ------------------------------------------------------------------------------

/** Finishes a game nobody touched for 5 minutes (or a duel nobody accepted) and returns its last view. */
async function expireGame(game: Game): Promise<View> {
  if (game.kind === 'bj') {
    blackjackStand(game.hand);
    const settled = await stored(settleBet(game.userId, game.id, game.hand.payout));
    return blackjackView(game, settled?.balance, 'Stood automatically after 5 minutes.');
  }
  if (game.kind === 'mn') {
    if (game.revealed.length === 0) {
      const refunded = await stored(refundBet(game.userId, game.id));
      return minesView(game, 'refunded', refunded?.balance);
    }
    const settled = await stored(settleBet(game.userId, game.id, minesPayout(game.bet, game.count, game.revealed.length)));
    return minesView(game, 'cashed', settled?.balance, 'Cashed out automatically after 5 minutes.');
  }
  await stored(refundBet(game.userId, game.id));
  return duelView(game, 'expired');
}

async function sweep(): Promise<void> {
  const now = Date.now();
  for (const game of [...games.values()]) {
    if (game.busy) continue;
    const due = game.kind === 'du' ? now > game.created + DUEL_MS : now - game.touched > IDLE_MS;
    if (!due) continue;
    game.busy = true;
    games.delete(game.id);
    try {
      const view = await expireGame(game);
      await game.message?.edit(view);
    } catch (error) {
      logger.warn({ err: error }, '[TCP Casino] Could not finish an idle game');
    }
  }
}

let sweeping: ReturnType<typeof setInterval> | null = null;

/** On startup: bets held by games of the last run go back (the games lived in memory), then the sweep starts. */
export async function initCasino(): Promise<void> {
  try {
    const refunded = await refundEverything();
    if (refunded > 0) logger.info(`[TCP Casino] Refunded ${refunded} bet${refunded === 1 ? '' : 's'} from games cut off by the restart`);
  } catch (error) {
    logger.warn({ err: error }, '[TCP Casino] Could not refund the bets of the last run');
  }
  if (sweeping) return;
  sweeping = setInterval(() => void sweep(), SWEEP_MS);
  sweeping.unref?.();
}
