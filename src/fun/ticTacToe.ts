import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  escapeMarkdown,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Interaction,
} from 'discord.js';
import { notice, tcpEmbed, type Tone } from '../bot/embeds.js';
import { getState, getStateStrict, setState } from '../database/stateStore.js';
import { logger } from '../utils/logger.js';
import {
  CHALLENGE_MS,
  DIFFICULTIES,
  EMPTY_BOARD,
  LEADERBOARD_ID,
  PVP_TURN_MS,
  TTT_PREFIX,
  againId,
  challengeId,
  moveId,
  other,
  parseId,
  playTurn,
  pvpClaimId,
  pvpMoveId,
  pvpPlay,
  pvpQuitId,
  quitId,
  rematchId,
  startBoard,
  toMove,
  winner,
  type Difficulty,
  type GameRef,
  type Mark,
  type Outcome,
  type PvpRef,
  type Starter,
} from './ticTacToeRules.js';
import { addResult, botTotal, playerOf, standings, type Result, type Standing, type Stats, type WLD } from './ticTacToeStats.js';

// Tic Tac Toe (/tcp tictactoe): against T.C.P (Easy, Normal, Hard), or against another member
// (opponent:@name), and the leaderboard (/tcp leaderboard). The board is the message's nine buttons; the
// whole game travels in the buttons' IDs, so games survive a redeploy. Records are one JSON value in the
// bot_state table ('ttt.stats'), written one game at a time.

const STATS_KEY = 'ttt.stats';
const nowSeconds = () => Math.floor(Date.now() / 1000);
const MEDALS = ['🥇', '🥈', '🥉'];

// ---- records ---------------------------------------------------------------------------------------------

let statsQueue: Promise<unknown> = Promise.resolve();

/** Changes the records, one change at a time so two games ending together both count. Never throws. */
function updateStats<T>(change: (stats: Stats) => T): Promise<T | null> {
  const run = statsQueue.then(async () => {
    // A strict read: if the records cannot be read, nothing is written over them.
    const stats = (await getStateStrict<Stats>(STATS_KEY)) ?? {};
    const result = change(stats);
    await setState(STATS_KEY, stats);
    return result;
  });
  statsQueue = run.catch(() => undefined);
  return run.catch((error: unknown) => {
    logger.warn({ err: error }, '[TCP Tic Tac Toe] Could not save the records');
    return null;
  });
}

async function readStats(): Promise<Stats> {
  await statsQueue;
  return getState<Stats>(STATS_KEY, {}).catch(() => ({}));
}

async function nameOf(interaction: Interaction, userId: string): Promise<string> {
  const member = interaction.guild ? await interaction.guild.members.fetch(userId).catch(() => null) : null;
  if (member) return member.displayName;
  const user = interaction.user.id === userId ? interaction.user : await interaction.client.users.fetch(userId).catch(() => null);
  return user?.displayName ?? 'Unknown player';
}

async function recordBotGame(interaction: Interaction, userId: string, difficulty: Difficulty, result: Result): Promise<WLD | null> {
  const name = await nameOf(interaction, userId);
  return updateStats((stats) => {
    const player = playerOf(stats, userId, name);
    addResult(player.bot[difficulty], result);
    return botTotal(player);
  });
}

async function recordPvpGame(interaction: Interaction, ref: PvpRef, won: Mark | null): Promise<{ x: WLD; o: WLD } | null> {
  const [xName, oName] = await Promise.all([nameOf(interaction, ref.xId), nameOf(interaction, ref.oId)]);
  const resultFor = (mark: Mark): Result => (won === null ? 'draw' : won === mark ? 'win' : 'loss');
  return updateStats((stats) => {
    const x = playerOf(stats, ref.xId, xName);
    const o = playerOf(stats, ref.oId, oName);
    addResult(x.pvp, resultFor('X'));
    addResult(o.pvp, resultFor('O'));
    return { x: { ...x.pvp }, o: { ...o.pvp } };
  });
}

const recordText = (record: WLD) => `${record.wins}W ${record.losses}L ${record.draws}D`;

// ---- shared pieces ---------------------------------------------------------------------------------------

// A press is handled once: a second press on the same version of the message (a double click, sent before
// the first press redrew the board) is ignored. Remembered for a few seconds only, so a new game on the same
// message (Play again, Rematch) that comes back to the same board is never blocked.
const DOUBLE_PRESS_MS = 3000;
const handled = new Map<string, number>();
function firstPress(interaction: ButtonInteraction, state: string): boolean {
  const now = Date.now();
  if (handled.size > 200) for (const [stored, at] of handled) if (now - at > DOUBLE_PRESS_MS) handled.delete(stored);
  const message = interaction.message;
  const key = `${message.id}:${message.editedTimestamp ?? message.createdTimestamp}:${state}`;
  const seen = handled.get(key);
  if (seen !== undefined && now - seen < DOUBLE_PRESS_MS) return false;
  handled.set(key, now);
  return true;
}

/** Whether the pressed button is still on the message (an older board's button is not). */
function stillShown(interaction: ButtonInteraction): boolean {
  const rows = interaction.message.components as unknown as { components?: { customId?: string | null }[] }[];
  return rows.some((row) => (row.components ?? []).some((component) => component.customId === interaction.customId));
}

function boardRows(board: string, idFor: (cell: number) => string, over: boolean) {
  const line = winner(board)?.line;
  return [0, 1, 2].map((row) =>
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      [0, 1, 2].map((column) => {
        const cell = row * 3 + column;
        const mark = board[cell];
        const button = new ButtonBuilder().setCustomId(idFor(cell));
        if (mark === '.') return button.setLabel('​').setStyle(ButtonStyle.Secondary).setDisabled(over);
        const style = line?.includes(cell) ? ButtonStyle.Success : mark === 'X' ? ButtonStyle.Primary : ButtonStyle.Danger;
        return button.setEmoji(mark === 'X' ? '❌' : '⭕').setStyle(style).setDisabled(true);
      }),
    ),
  );
}

const leaderboardButton = () => new ButtonBuilder().setCustomId(LEADERBOARD_ID).setLabel('🏆 Leaderboard').setStyle(ButtonStyle.Secondary);
const controlRow = (...buttons: ButtonBuilder[]) => new ActionRowBuilder<ButtonBuilder>().addComponents(buttons);
const tell = (interaction: ButtonInteraction, text: string) => interaction.reply({ ...notice(text), ephemeral: true });

// ---- against T.C.P ---------------------------------------------------------------------------------------

type BotEnding = Outcome | 'quit';

const BOT_ENDINGS: Record<BotEnding, { text: string; tone: Tone }> = {
  win: { text: '🏆 **You win!**', tone: 'success' },
  loss: { text: '🤖 **T.C.P wins.**', tone: 'danger' },
  draw: { text: '🤝 **Draw.**', tone: 'muted' },
  quit: { text: '🏳️ **You gave up.** T.C.P takes it.', tone: 'muted' },
};

const difficultyLabel = (difficulty: Difficulty) => (difficulty === 'hard' ? 'Hard (unbeatable)' : DIFFICULTIES[difficulty].label);

function botGameView(ref: GameRef, ending: BotEnding | null, record?: WLD | null) {
  const lines = [`<@${ref.userId}> ❌ vs **T.C.P** ⭕ · ${difficultyLabel(ref.difficulty)}`, ''];
  if (ending === null) {
    lines.push(ref.starter === 'b' && ref.board.replace(/\./g, '').length === 1 ? 'T.C.P went first. **Your move.**' : '**Your move:** pick a square.');
  } else {
    lines.push(BOT_ENDINGS[ending].text + (ending === 'draw' && ref.difficulty === 'hard' ? ' Nobody beats Hard: a draw is the best there is.' : ''));
    if (record) lines.push('', `Your record against T.C.P: **${record.wins}** won, **${record.losses}** lost, **${record.draws}** drawn.`);
  }

  // Play again swaps who goes first; the other difficulties start a game at that level.
  const nextStarter: Starter = ref.starter === 'p' ? 'b' : 'p';
  const controls =
    ending === null
      ? [new ButtonBuilder().setCustomId(quitId(ref)).setLabel('Give up').setStyle(ButtonStyle.Danger)]
      : [
          new ButtonBuilder().setCustomId(againId(ref.userId, ref.difficulty, nextStarter)).setLabel('Play again').setStyle(ButtonStyle.Primary),
          ...(Object.keys(DIFFICULTIES) as Difficulty[])
            .filter((difficulty) => difficulty !== ref.difficulty)
            .map((difficulty) =>
              new ButtonBuilder().setCustomId(againId(ref.userId, difficulty, nextStarter)).setLabel(DIFFICULTIES[difficulty].label).setStyle(ButtonStyle.Secondary),
            ),
          leaderboardButton(),
        ];

  // The players are named in the embed, which never pings.
  return {
    embeds: [tcpEmbed({ title: '🎮 Tic Tac Toe', description: lines.join('\n'), tone: ending ? BOT_ENDINGS[ending].tone : 'brand' })],
    components: [...boardRows(ref.board, (cell) => moveId(ref, cell), ending !== null), controlRow(...controls)],
  };
}

// ---- against another member ------------------------------------------------------------------------------

interface PvpEnding {
  kind: 'line' | 'draw' | 'quit' | 'timeout';
  /** The winning mark; null for a draw. */
  won: Mark | null;
}

const playerId = (ref: PvpRef, mark: Mark) => (mark === 'X' ? ref.xId : ref.oId);
const markOf = (ref: PvpRef, userId: string): Mark | null => (userId === ref.xId ? 'X' : userId === ref.oId ? 'O' : null);

function pvpGameView(ref: PvpRef, ending: PvpEnding | null, records?: { x: WLD; o: WLD } | null) {
  const lines = [`<@${ref.xId}> ❌ vs <@${ref.oId}> ⭕ · player vs player`, ''];
  if (ending === null) {
    const mark = toMove(ref.board);
    const waiting = playerId(ref, other(mark));
    lines.push(`**<@${playerId(ref, mark)}>'s move** (${mark === 'X' ? '❌' : '⭕'}).`);
    lines.push(`If there is no move <t:${ref.at + PVP_TURN_MS / 1000}:R>, <@${waiting}> can claim the win.`);
  } else {
    const winnerText = ending.won ? `🏆 **<@${playerId(ref, ending.won)}> wins!**` : '';
    const loserId = ending.won ? playerId(ref, other(ending.won)) : '';
    if (ending.kind === 'draw') lines.push('🤝 **Draw.**');
    else if (ending.kind === 'line') lines.push(winnerText);
    else if (ending.kind === 'quit') lines.push(`🏳️ <@${loserId}> gave up. ${winnerText}`);
    else lines.push(`⏱️ <@${loserId}> ran out of time. ${winnerText}`);
    if (records) lines.push('', `PvP records: <@${ref.xId}> ${recordText(records.x)} · <@${ref.oId}> ${recordText(records.o)}`);
  }

  const controls =
    ending === null
      ? [
          new ButtonBuilder().setCustomId(pvpQuitId(ref)).setLabel('Give up').setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId(pvpClaimId(ref)).setLabel('⏱️ Claim win').setStyle(ButtonStyle.Secondary),
        ]
      : [new ButtonBuilder().setCustomId(rematchId(ref.oId, ref.xId)).setLabel('Rematch').setStyle(ButtonStyle.Primary), leaderboardButton()];

  return {
    content: '',
    embeds: [
      tcpEmbed({
        title: '⚔️ Tic Tac Toe',
        description: lines.join('\n'),
        tone: ending === null ? 'brand' : ending.won ? 'success' : 'muted',
      }),
    ],
    components: [...boardRows(ref.board, (cell) => pvpMoveId(ref, cell), ending !== null), controlRow(...controls)],
  };
}

type ChallengeState = 'open' | 'declined' | 'withdrawn' | 'expired';

function challengeView(challengerId: string, opponentId: string, at: number, state: ChallengeState) {
  if (state !== 'open') {
    const text =
      state === 'declined'
        ? `<@${opponentId}> declined <@${challengerId}>'s challenge.`
        : state === 'withdrawn'
          ? `<@${challengerId}> withdrew the challenge.`
          : `<@${challengerId}>'s challenge to <@${opponentId}> expired.`;
    return { content: '', embeds: [tcpEmbed({ title: '⚔️ Tic Tac Toe challenge', description: text, tone: 'muted' })], components: [] };
  }
  return {
    // The challenged member is pinged once, in the text above the card.
    content: `<@${opponentId}>`,
    allowedMentions: { users: [opponentId] },
    embeds: [
      tcpEmbed({
        title: '⚔️ Tic Tac Toe challenge',
        description: `<@${challengerId}> challenges <@${opponentId}> to Tic Tac Toe!\n\n<@${challengerId}> plays ❌ and goes first. The challenge expires <t:${at + CHALLENGE_MS / 1000}:R>.`,
      }),
    ],
    components: [
      controlRow(
        new ButtonBuilder().setCustomId(challengeId(challengerId, opponentId, at, 'accept')).setLabel('Accept').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(challengeId(challengerId, opponentId, at, 'decline')).setLabel('Decline').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(challengeId(challengerId, opponentId, at, 'withdraw')).setLabel('Withdraw').setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}

// ---- the leaderboard -------------------------------------------------------------------------------------

function standingLine(standing: Standing, place: number): string {
  const badge = MEDALS[place] ?? `**${place + 1}.**`;
  return `${badge} ${escapeMarkdown(standing.name.slice(0, 32))} · **${standing.points}** pts · ${recordText(standing.record)}`;
}

function placeOf(list: Standing[], userId: string): string | null {
  const index = list.findIndex((standing) => standing.id === userId);
  return index < 0 ? null : `#${index + 1} of ${list.length} (${list[index]!.points} pts)`;
}

export function leaderboardView(stats: Stats, viewerId: string) {
  const pvp = standings(stats, 'pvp');
  const bot = standings(stats, 'bot');
  const mine = [placeOf(pvp, viewerId) && `PvP ${placeOf(pvp, viewerId)}`, placeOf(bot, viewerId) && `against T.C.P ${placeOf(bot, viewerId)}`].filter(Boolean);
  const description = [
    'Player vs player: **3** points a win, **1** a draw.',
    'Against T.C.P: a win on Easy **1**, on Normal **3** (a draw **1**), a draw on Hard **2**.',
    ...(mine.length > 0 ? ['', `**You:** ${mine.join(' · ')}`] : []),
  ].join('\n');
  return {
    embeds: [
      tcpEmbed({
        title: '🏆 Tic Tac Toe leaderboard',
        description,
        fields: [
          {
            name: '⚔️ Player vs player',
            value: pvp.slice(0, 10).map(standingLine).join('\n') || 'No games yet. Challenge someone: `/tcp tictactoe opponent:@name`.',
          },
          { name: '🤖 Against T.C.P', value: bot.slice(0, 5).map(standingLine).join('\n') || 'No games yet: `/tcp tictactoe`.' },
        ],
      }),
    ],
  };
}

// ---- commands --------------------------------------------------------------------------------------------

export async function handleTicTacToeCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const opponent = interaction.options.getUser('opponent');
  if (opponent && opponent.id !== interaction.client.user.id) {
    if (opponent.id === interaction.user.id) {
      await interaction.reply({ ...notice('You cannot challenge yourself. Leave **opponent** empty to play T.C.P.'), ephemeral: true });
      return;
    }
    if (opponent.bot) {
      await interaction.reply({ ...notice('Bots cannot play. Challenge a member, or leave **opponent** empty to play T.C.P.'), ephemeral: true });
      return;
    }
    await interaction.reply(challengeView(interaction.user.id, opponent.id, nowSeconds(), 'open'));
    return;
  }
  const chosen = interaction.options.getString('difficulty');
  const difficulty: Difficulty = chosen === 'easy' || chosen === 'hard' ? chosen : 'normal';
  const ref: GameRef = { userId: interaction.user.id, difficulty, starter: 'p', board: startBoard(difficulty, 'p') };
  await interaction.reply(botGameView(ref, null));
}

export async function handleLeaderboardCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.reply(leaderboardView(await readStats(), interaction.user.id));
}

// ---- buttons ---------------------------------------------------------------------------------------------

export async function handleTicTacToeInteraction(interaction: Interaction): Promise<boolean> {
  if (!interaction.isButton() || !interaction.customId.startsWith(TTT_PREFIX)) return false;
  const parsed = parseId(interaction.customId);
  const userId = interaction.user.id;
  if (!parsed) {
    await interaction.deferUpdate();
    return true;
  }

  if (parsed.action === 'leaderboard') {
    await interaction.reply({ ...leaderboardView(await readStats(), userId), ephemeral: true });
    return true;
  }

  // ---- against T.C.P ----
  if (parsed.action === 'move' || parsed.action === 'quit' || parsed.action === 'again') {
    const ownerId = parsed.action === 'again' ? parsed.userId : parsed.ref.userId;
    if (ownerId !== userId) {
      await tell(interaction, `This is <@${ownerId}>'s game. Start your own with \`/tcp tictactoe\`.`);
      return true;
    }
    if (parsed.action === 'again') {
      const ref: GameRef = { userId, difficulty: parsed.difficulty, starter: parsed.starter, board: startBoard(parsed.difficulty, parsed.starter) };
      await interaction.update(botGameView(ref, null));
      return true;
    }
    if (!stillShown(interaction) || !firstPress(interaction, parsed.ref.board)) {
      await interaction.deferUpdate();
      return true;
    }
    const { ref } = parsed;
    if (parsed.action === 'quit') {
      await interaction.update(botGameView(ref, 'quit'));
      const record = await recordBotGame(interaction, userId, ref.difficulty, 'loss');
      if (record) await interaction.editReply(botGameView(ref, 'quit', record));
      return true;
    }
    const turn = playTurn(ref.board, parsed.cell, ref.difficulty);
    if (!turn) {
      await interaction.deferUpdate();
      return true;
    }
    const next: GameRef = { ...ref, board: turn.board };
    await interaction.update(botGameView(next, turn.outcome));
    if (turn.outcome) {
      const record = await recordBotGame(interaction, userId, ref.difficulty, turn.outcome);
      if (record) await interaction.editReply(botGameView(next, turn.outcome, record));
    }
    return true;
  }

  // ---- challenges ----
  if (parsed.action === 'challenge') {
    const { challengerId, opponentId, at, op } = parsed;
    if (op === 'withdraw' ? userId !== challengerId : userId !== opponentId) {
      await tell(
        interaction,
        userId === challengerId
          ? `Waiting for <@${opponentId}> to answer. Press **Withdraw** to call it off.`
          : userId === opponentId
            ? `Only <@${challengerId}> can withdraw it. Accept or decline.`
            : `This challenge is for <@${opponentId}>. Start your own with \`/tcp tictactoe opponent:@name\`.`,
      );
      return true;
    }
    if (!stillShown(interaction) || !firstPress(interaction, 'challenge')) {
      await interaction.deferUpdate();
      return true;
    }
    if (op === 'withdraw' || op === 'decline') {
      await interaction.update(challengeView(challengerId, opponentId, at, op === 'decline' ? 'declined' : 'withdrawn'));
      return true;
    }
    if (Date.now() > (at * 1000) + CHALLENGE_MS) {
      await interaction.update(challengeView(challengerId, opponentId, at, 'expired'));
      return true;
    }
    await interaction.update(pvpGameView({ xId: challengerId, oId: opponentId, board: EMPTY_BOARD, at: nowSeconds() }, null));
    return true;
  }

  // ---- against another member ----
  if (parsed.action === 'rematch') {
    if (userId !== parsed.xId && userId !== parsed.oId) {
      await tell(interaction, 'Only the two players can start a rematch. Challenge someone with `/tcp tictactoe opponent:@name`.');
      return true;
    }
    if (!stillShown(interaction) || !firstPress(interaction, 'rematch')) {
      await interaction.deferUpdate();
      return true;
    }
    await interaction.update(pvpGameView({ xId: parsed.xId, oId: parsed.oId, board: EMPTY_BOARD, at: nowSeconds() }, null));
    return true;
  }

  const { ref } = parsed;
  const mine = markOf(ref, userId);
  if (!mine) {
    await tell(interaction, `This is <@${ref.xId}> and <@${ref.oId}>'s game. Challenge someone with \`/tcp tictactoe opponent:@name\`.`);
    return true;
  }
  const onTurn = toMove(ref.board);

  if (parsed.action === 'pmove' && mine !== onTurn) {
    await tell(interaction, `Not your turn: waiting for <@${playerId(ref, onTurn)}>.`);
    return true;
  }
  if (parsed.action === 'pclaim') {
    if (mine === onTurn) {
      await tell(interaction, 'It is your move.');
      return true;
    }
    const deadline = ref.at + PVP_TURN_MS / 1000;
    if (nowSeconds() < deadline) {
      await tell(interaction, `You can claim the win <t:${deadline}:R> if <@${playerId(ref, onTurn)}> still has not moved.`);
      return true;
    }
  }
  if (!stillShown(interaction) || !firstPress(interaction, ref.board)) {
    await interaction.deferUpdate();
    return true;
  }

  let ending: PvpEnding | null = null;
  let next = ref;
  if (parsed.action === 'pquit') ending = { kind: 'quit', won: other(mine) };
  else if (parsed.action === 'pclaim') ending = { kind: 'timeout', won: mine };
  else {
    const played = pvpPlay(ref.board, parsed.cell);
    if (!played) {
      await interaction.deferUpdate();
      return true;
    }
    next = { ...ref, board: played.board, at: nowSeconds() };
    if (played.outcome === 'draw') ending = { kind: 'draw', won: null };
    else if (played.outcome) ending = { kind: 'line', won: played.outcome };
  }

  await interaction.update(pvpGameView(next, ending));
  if (ending) {
    const records = await recordPvpGame(interaction, next, ending.won);
    if (records) await interaction.editReply(pvpGameView(next, ending, records));
  }
  return true;
}
