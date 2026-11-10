import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Interaction,
} from 'discord.js';
import { notice, tcpEmbed, type Tone } from '../bot/embeds.js';
import { getState, setState } from '../database/stateStore.js';
import { logger } from '../utils/logger.js';
import {
  DIFFICULTIES,
  TTT_PREFIX,
  againId,
  moveId,
  parseId,
  playTurn,
  quitId,
  startBoard,
  winner,
  type Difficulty,
  type GameRef,
  type Outcome,
  type Starter,
} from './ticTacToeRules.js';

// Tic Tac Toe against T.C.P (/tcp tictactoe): the board is the message's nine buttons, and only the member
// who started the game can press them. The member is ❌, the bot ⭕. Each member's record is kept in the
// bot_state table ('ttt.record.<id>').

type Ending = Outcome | 'quit';

interface GameRecord {
  wins: number;
  losses: number;
  draws: number;
}

const ENDINGS: Record<Ending, { text: string; tone: Tone }> = {
  win: { text: '🏆 **You win!**', tone: 'success' },
  loss: { text: '🤖 **T.C.P wins.**', tone: 'danger' },
  draw: { text: '🤝 **Draw.**', tone: 'muted' },
  quit: { text: '🏳️ **You gave up.** T.C.P takes it.', tone: 'muted' },
};

const difficultyLabel = (difficulty: Difficulty) => (difficulty === 'hard' ? 'Hard (unbeatable)' : DIFFICULTIES[difficulty].label);

function cellButton(ref: GameRef, cell: number, over: boolean, line: readonly number[] | undefined): ButtonBuilder {
  const mark = ref.board[cell];
  const button = new ButtonBuilder().setCustomId(moveId(ref, cell));
  if (mark === '.') return button.setLabel('​').setStyle(ButtonStyle.Secondary).setDisabled(over);
  const style = line?.includes(cell) ? ButtonStyle.Success : mark === 'X' ? ButtonStyle.Primary : ButtonStyle.Danger;
  return button.setEmoji(mark === 'X' ? '❌' : '⭕').setStyle(style).setDisabled(true);
}

function gameView(ref: GameRef, ending: Ending | null, record?: GameRecord | null) {
  const line = winner(ref.board)?.line;
  const over = ending !== null;
  const rows = [0, 1, 2].map((row) =>
    new ActionRowBuilder<ButtonBuilder>().addComponents([0, 1, 2].map((column) => cellButton(ref, row * 3 + column, over, line))),
  );

  const header = `<@${ref.userId}> ❌ vs **T.C.P** ⭕ · ${difficultyLabel(ref.difficulty)}`;
  const lines = [header, ''];
  if (ending === null) {
    lines.push(ref.starter === 'b' && ref.board.replace(/\./g, '').length === 1 ? 'T.C.P went first. **Your move.**' : '**Your move:** pick a square.');
  } else {
    lines.push(ENDINGS[ending].text + (ending === 'draw' && ref.difficulty === 'hard' ? ' Nobody beats Hard: a draw is the best there is.' : ''));
    if (record) lines.push('', `Your record against T.C.P: **${record.wins}** won, **${record.losses}** lost, **${record.draws}** drawn.`);
  }

  // Play again swaps who goes first; the other two buttons switch the difficulty.
  const nextStarter: Starter = ref.starter === 'p' ? 'b' : 'p';
  const controls = over
    ? [
        new ButtonBuilder().setCustomId(againId(ref.userId, ref.difficulty, nextStarter)).setLabel('Play again').setStyle(ButtonStyle.Primary),
        ...(Object.keys(DIFFICULTIES) as Difficulty[])
          .filter((difficulty) => difficulty !== ref.difficulty)
          .map((difficulty) =>
            new ButtonBuilder().setCustomId(againId(ref.userId, difficulty, nextStarter)).setLabel(DIFFICULTIES[difficulty].label).setStyle(ButtonStyle.Secondary),
          ),
      ]
    : [new ButtonBuilder().setCustomId(quitId(ref)).setLabel('Give up').setStyle(ButtonStyle.Danger)];

  // The member is named in the embed, which never pings.
  return {
    embeds: [tcpEmbed({ title: '🎮 Tic Tac Toe', description: lines.join('\n'), tone: ending ? ENDINGS[ending].tone : 'brand' })],
    components: [...rows, new ActionRowBuilder<ButtonBuilder>().addComponents(controls)],
  };
}

/** Adds the game to the member's record. Never throws: without the database the game still ends. */
async function recordGame(userId: string, ending: Ending): Promise<GameRecord | null> {
  const key = `ttt.record.${userId}`;
  try {
    const stored = await getState<GameRecord>(key, { wins: 0, losses: 0, draws: 0 });
    const record = { wins: stored.wins ?? 0, losses: stored.losses ?? 0, draws: stored.draws ?? 0 };
    if (ending === 'win') record.wins += 1;
    else if (ending === 'draw') record.draws += 1;
    else record.losses += 1;
    await setState(key, record);
    return record;
  } catch (error) {
    logger.warn({ err: error }, '[TCP Tic Tac Toe] Could not save a record');
    return null;
  }
}

/** The board the message shows now, from its buttons; null when the game on it is over. */
function boardOnMessage(interaction: ButtonInteraction): string | null {
  const rows = interaction.message.components as unknown as { components?: { customId?: string | null }[] }[];
  for (const row of rows) {
    for (const component of row.components ?? []) {
      const parsed = component.customId ? parseId(component.customId) : null;
      if (parsed && parsed.action !== 'again') return parsed.ref.board;
    }
  }
  return null;
}

export async function handleTicTacToeCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const chosen = interaction.options.getString('difficulty');
  const difficulty: Difficulty = chosen === 'easy' || chosen === 'hard' ? chosen : 'normal';
  const ref: GameRef = { userId: interaction.user.id, difficulty, starter: 'p', board: startBoard(difficulty, 'p') };
  await interaction.reply(gameView(ref, null));
}

export async function handleTicTacToeInteraction(interaction: Interaction): Promise<boolean> {
  if (!interaction.isButton() || !interaction.customId.startsWith(TTT_PREFIX)) return false;
  const parsed = parseId(interaction.customId);
  if (!parsed) {
    await interaction.deferUpdate();
    return true;
  }
  const ownerId = parsed.action === 'again' ? parsed.userId : parsed.ref.userId;
  if (ownerId !== interaction.user.id) {
    await interaction.reply({ ...notice(`This is <@${ownerId}>'s game. Start your own with \`/tcp tictactoe\`.`), ephemeral: true });
    return true;
  }

  if (parsed.action === 'again') {
    const ref: GameRef = { userId: parsed.userId, difficulty: parsed.difficulty, starter: parsed.starter, board: startBoard(parsed.difficulty, parsed.starter) };
    await interaction.update(gameView(ref, null));
    return true;
  }

  // A second press sent before the board was redrawn carries the board before it: ignore it.
  if (boardOnMessage(interaction) !== parsed.ref.board) {
    await interaction.deferUpdate();
    return true;
  }

  if (parsed.action === 'quit') {
    await interaction.update(gameView(parsed.ref, 'quit', await recordGame(parsed.ref.userId, 'quit')));
    return true;
  }

  const turn = playTurn(parsed.ref.board, parsed.cell, parsed.ref.difficulty);
  if (!turn) {
    await interaction.deferUpdate();
    return true;
  }
  const ref: GameRef = { ...parsed.ref, board: turn.board };
  await interaction.update(gameView(ref, turn.outcome, turn.outcome ? await recordGame(ref.userId, turn.outcome) : null));
  return true;
}
