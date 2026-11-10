// Tic Tac Toe against T.C.P: the rules, the bot's moves and the button IDs, free of Discord so they can be
// tested. The member is X, the bot O. A board is nine characters, row by row: 'X', 'O' or '.' for empty.
// The whole game lives in the buttons' IDs, so a game survives a redeploy and nothing is kept in memory.

export type Mark = 'X' | 'O';
export type Difficulty = 'easy' | 'normal' | 'hard';
/** Who made the first move of the game: the player ('p') or the bot ('b'). */
export type Starter = 'p' | 'b';

export const EMPTY_BOARD = '.........';
export const DIFFICULTIES: Record<Difficulty, { label: string; code: string }> = {
  easy: { label: 'Easy', code: 'e' },
  normal: { label: 'Normal', code: 'n' },
  hard: { label: 'Hard', code: 'h' },
};
/** On Normal, the share of free moves (no win to take, nothing to block) where the bot plays its best. */
export const NORMAL_SHARP = 0.6;

export const LINES: readonly (readonly [number, number, number])[] = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];

export const other = (mark: Mark): Mark => (mark === 'X' ? 'O' : 'X');

export function winner(board: string): { mark: Mark; line: readonly number[] } | null {
  for (const line of LINES) {
    const mark = board[line[0]];
    if (mark !== '.' && mark === board[line[1]] && mark === board[line[2]]) return { mark: mark as Mark, line };
  }
  return null;
}

export function emptyCells(board: string): number[] {
  const cells: number[] = [];
  for (let cell = 0; cell < 9; cell += 1) if (board[cell] === '.') cells.push(cell);
  return cells;
}

export function isOver(board: string): boolean {
  return winner(board) !== null || emptyCells(board).length === 0;
}

export function place(board: string, cell: number, mark: Mark): string {
  return board.slice(0, cell) + mark + board.slice(cell + 1);
}

const count = (board: string, mark: Mark) => [...board].filter((cell) => cell === mark).length;

/** A board that can come up in a game the given side started, with the player to move. */
export function isPlayableBoard(board: string, starter: Starter): boolean {
  if (!/^[XO.]{9}$/.test(board)) return false;
  const x = count(board, 'X');
  const o = count(board, 'O');
  return starter === 'p' ? x === o : o === x + 1;
}

const scores = new Map<string, number>();

/**
 * The board's value for the side to move: a win is worth more the sooner it comes, a loss costs more the
 * sooner it comes, a draw is 0. The whole game has under 6,000 positions, so they are all remembered.
 */
function score(board: string, toMove: Mark): number {
  const key = board + toMove;
  const known = scores.get(key);
  if (known !== undefined) return known;
  const empty = emptyCells(board);
  let value: number;
  if (winner(board)) value = -(10 + empty.length);
  else if (empty.length === 0) value = 0;
  else value = Math.max(...empty.map((cell) => -score(place(board, cell, toMove), other(toMove))));
  scores.set(key, value);
  return value;
}

/** Every move that is as good as any other for `mark` (perfect play). */
export function bestMoves(board: string, mark: Mark): number[] {
  let best = -Infinity;
  let moves: number[] = [];
  for (const cell of emptyCells(board)) {
    const value = -score(place(board, cell, mark), other(mark));
    if (value > best) {
      best = value;
      moves = [cell];
    } else if (value === best) moves.push(cell);
  }
  return moves;
}

function winningMove(board: string, mark: Mark): number | undefined {
  return emptyCells(board).find((cell) => winner(place(board, cell, mark))?.mark === mark);
}

const pick = (cells: number[], rng: () => number) => cells[Math.min(cells.length - 1, Math.floor(rng() * cells.length))]!;

/**
 * The bot's move. Hard plays perfectly (a draw is the best anyone can get). Normal takes a win, blocks yours,
 * and otherwise plays its best NORMAL_SHARP of the time, so a fork beats it. Easy takes a win when it sees one
 * and otherwise plays anywhere.
 */
export function botMove(board: string, difficulty: Difficulty, rng: () => number = Math.random): number {
  const empty = emptyCells(board);
  if (empty.length === 0) throw new Error('No move on a full board');
  if (difficulty === 'hard') return pick(bestMoves(board, 'O'), rng);
  const win = winningMove(board, 'O');
  if (win !== undefined) return win;
  if (difficulty === 'easy') return pick(empty, rng);
  const block = winningMove(board, 'X');
  if (block !== undefined) return block;
  return rng() < NORMAL_SHARP ? pick(bestMoves(board, 'O'), rng) : pick(empty, rng);
}

export type Outcome = 'win' | 'loss' | 'draw';

function outcomeOf(board: string): Outcome | null {
  const won = winner(board);
  if (won) return won.mark === 'X' ? 'win' : 'loss';
  return emptyCells(board).length === 0 ? 'draw' : null;
}

/** A new game's board: empty, or with the bot's opening move when the bot starts. */
export function startBoard(difficulty: Difficulty, starter: Starter, rng: () => number = Math.random): string {
  return starter === 'b' ? place(EMPTY_BOARD, botMove(EMPTY_BOARD, difficulty, rng), 'O') : EMPTY_BOARD;
}

/** The member plays `cell`, then the bot answers. Null when the move is not allowed. */
export function playTurn(
  board: string,
  cell: number,
  difficulty: Difficulty,
  rng: () => number = Math.random,
): { board: string; outcome: Outcome | null } | null {
  if (!Number.isInteger(cell) || cell < 0 || cell > 8 || board[cell] !== '.' || isOver(board)) return null;
  let next = place(board, cell, 'X');
  const afterMember = outcomeOf(next);
  if (afterMember) return { board: next, outcome: afterMember };
  next = place(next, botMove(next, difficulty, rng), 'O');
  return { board: next, outcome: outcomeOf(next) };
}

// ---- player against player -------------------------------------------------------------------------------
// X always moves first, so the side to move follows from the board. The time of the last move travels in the
// buttons too, so the waiting player can claim the win once the other has taken too long.

/** How long a player has for a move before the other can claim the win. */
export const PVP_TURN_MS = 2 * 60 * 1000;
/** How long a challenge stays open. */
export const CHALLENGE_MS = 10 * 60 * 1000;

export const toMove = (board: string): Mark => (count(board, 'X') === count(board, 'O') ? 'X' : 'O');

export function isPvpBoard(board: string): boolean {
  if (!/^[XO.]{9}$/.test(board)) return false;
  const x = count(board, 'X');
  const o = count(board, 'O');
  return x === o || x === o + 1;
}

/** The player on turn plays `cell`. The outcome is the winning mark, 'draw', or null while the game goes on. */
export function pvpPlay(board: string, cell: number): { board: string; outcome: Mark | 'draw' | null } | null {
  if (!isPvpBoard(board) || !Number.isInteger(cell) || cell < 0 || cell > 8 || board[cell] !== '.' || isOver(board)) return null;
  const next = place(board, cell, toMove(board));
  const won = winner(next);
  return { board: next, outcome: won ? won.mark : emptyCells(next).length === 0 ? 'draw' : null };
}

// ---- button IDs ----------------------------------------------------------------------------------------

export const TTT_PREFIX = 'tcp-ttt:';

export interface GameRef {
  userId: string;
  difficulty: Difficulty;
  starter: Starter;
  board: string;
}

const codeOf = (difficulty: Difficulty) => DIFFICULTIES[difficulty].code;
const difficultyOf = (code: string) => (Object.keys(DIFFICULTIES) as Difficulty[]).find((key) => DIFFICULTIES[key].code === code);

export const moveId = (ref: GameRef, cell: number) => `${TTT_PREFIX}m:${ref.userId}:${codeOf(ref.difficulty)}${ref.starter}:${ref.board}:${cell}`;
export const quitId = (ref: GameRef) => `${TTT_PREFIX}q:${ref.userId}:${codeOf(ref.difficulty)}${ref.starter}:${ref.board}`;
export const againId = (userId: string, difficulty: Difficulty, starter: Starter) => `${TTT_PREFIX}n:${userId}:${codeOf(difficulty)}${starter}`;

/** A game between two members: who is X (moves first), who is O, the board and the last move's time (seconds). */
export interface PvpRef {
  xId: string;
  oId: string;
  board: string;
  at: number;
}

const stamp = (seconds: number) => Math.max(0, Math.floor(seconds)).toString(36);
const pvpPart = (ref: PvpRef) => `${ref.xId}:${ref.oId}:${ref.board}:${stamp(ref.at)}`;

export const pvpMoveId = (ref: PvpRef, cell: number) => `${TTT_PREFIX}p:${pvpPart(ref)}:${cell}`;
export const pvpQuitId = (ref: PvpRef) => `${TTT_PREFIX}f:${pvpPart(ref)}`;
export const pvpClaimId = (ref: PvpRef) => `${TTT_PREFIX}w:${pvpPart(ref)}`;
/** A new game between the same two, sides swapped: the old O is the new X. */
export const rematchId = (xId: string, oId: string) => `${TTT_PREFIX}r:${xId}:${oId}`;
export type ChallengeOp = 'accept' | 'decline' | 'withdraw';
const OP_CODES: Record<ChallengeOp, string> = { accept: 'a', decline: 'd', withdraw: 'x' };
export const challengeId = (challengerId: string, opponentId: string, at: number, op: ChallengeOp) =>
  `${TTT_PREFIX}c:${challengerId}:${opponentId}:${stamp(at)}:${OP_CODES[op]}`;
export const LEADERBOARD_ID = `${TTT_PREFIX}l`;

export type ParsedId =
  | { action: 'move'; ref: GameRef; cell: number }
  | { action: 'quit'; ref: GameRef }
  | { action: 'again'; userId: string; difficulty: Difficulty; starter: Starter }
  | { action: 'pmove'; ref: PvpRef; cell: number }
  | { action: 'pquit'; ref: PvpRef }
  | { action: 'pclaim'; ref: PvpRef }
  | { action: 'rematch'; xId: string; oId: string }
  | { action: 'challenge'; challengerId: string; opponentId: string; at: number; op: ChallengeOp }
  | { action: 'leaderboard' };

const isUserId = (id: string | undefined): id is string => Boolean(id && /^\d{5,25}$/.test(id));
const isCell = (cell: string | undefined): cell is string => cell !== undefined && /^[0-8]$/.test(cell);
const parseStamp = (text: string | undefined) => (text && /^[0-9a-z]{1,10}$/.test(text) ? parseInt(text, 36) : NaN);

export function parseId(id: string): ParsedId | null {
  if (!id.startsWith(TTT_PREFIX)) return null;
  const parts = id.slice(TTT_PREFIX.length).split(':');
  const action = parts[0];

  if (action === 'l') return parts.length === 1 ? { action: 'leaderboard' } : null;

  if (action === 'm' || action === 'q' || action === 'n') {
    const [, userId, settings, board, cell] = parts;
    if (!isUserId(userId) || !settings || settings.length !== 2) return null;
    const difficulty = difficultyOf(settings[0]!);
    const starter = settings[1] === 'p' || settings[1] === 'b' ? settings[1] : null;
    if (!difficulty || !starter) return null;
    if (action === 'n') return { action: 'again', userId, difficulty, starter };
    if (!board || !isPlayableBoard(board, starter)) return null;
    const ref: GameRef = { userId, difficulty, starter, board };
    if (action === 'q') return { action: 'quit', ref };
    return isCell(cell) ? { action: 'move', ref, cell: Number(cell) } : null;
  }

  if (action === 'p' || action === 'f' || action === 'w') {
    const [, xId, oId, board, at, cell] = parts;
    const seconds = parseStamp(at);
    if (!isUserId(xId) || !isUserId(oId) || xId === oId || !board || !isPvpBoard(board) || !Number.isFinite(seconds)) return null;
    const ref: PvpRef = { xId, oId, board, at: seconds };
    if (action === 'f') return { action: 'pquit', ref };
    if (action === 'w') return { action: 'pclaim', ref };
    return isCell(cell) ? { action: 'pmove', ref, cell: Number(cell) } : null;
  }

  if (action === 'r') {
    const [, xId, oId] = parts;
    return isUserId(xId) && isUserId(oId) && xId !== oId ? { action: 'rematch', xId, oId } : null;
  }

  if (action === 'c') {
    const [, challengerId, opponentId, at, code] = parts;
    const seconds = parseStamp(at);
    const op = (Object.keys(OP_CODES) as ChallengeOp[]).find((key) => OP_CODES[key] === code);
    if (!isUserId(challengerId) || !isUserId(opponentId) || challengerId === opponentId || !Number.isFinite(seconds) || !op) return null;
    return { action: 'challenge', challengerId, opponentId, at: seconds, op };
  }

  return null;
}
