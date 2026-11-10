import { describe, expect, it } from 'vitest';
import {
  EMPTY_BOARD,
  againId,
  bestMoves,
  botMove,
  emptyCells,
  isPlayableBoard,
  moveId,
  other,
  parseId,
  place,
  playTurn,
  quitId,
  startBoard,
  winner,
  type GameRef,
  type Mark,
} from '../src/fun/ticTacToeRules.js';

const always = (value: number) => () => value;

describe('tic tac toe rules', () => {
  it('finds the winner and the winning line', () => {
    expect(winner('XXXOO....')).toEqual({ mark: 'X', line: [0, 1, 2] });
    expect(winner('O.XXO.X.O')).toEqual({ mark: 'O', line: [0, 4, 8] });
    expect(winner('XOXXOOOXX')).toBeNull();
    expect(emptyCells('X...O....')).toEqual([1, 2, 3, 5, 6, 7, 8]);
  });

  it('Hard never loses, whoever starts and whatever the member plays', () => {
    let games = 0;
    let draws = 0;
    // Every member move against every move Hard rates as best.
    const explore = (board: string, toMove: Mark): void => {
      const won = winner(board);
      if (won) {
        expect(won.mark).toBe('O');
        games += 1;
        return;
      }
      if (emptyCells(board).length === 0) {
        games += 1;
        draws += 1;
        return;
      }
      const moves = toMove === 'X' ? emptyCells(board) : bestMoves(board, 'O');
      for (const cell of moves) explore(place(board, cell, toMove), other(toMove));
    };
    explore(EMPTY_BOARD, 'X');
    explore(EMPTY_BOARD, 'O');
    expect(games).toBeGreaterThan(1000);
    expect(draws).toBeGreaterThan(0);
  });

  it('takes a win before blocking, on every difficulty', () => {
    // O wins on 5; X threatens 2.
    const board = 'XX.OO...X';
    for (const difficulty of ['easy', 'normal', 'hard'] as const) expect(botMove(board, difficulty, always(0.99))).toBe(5);
  });

  it('Normal blocks, Easy does not have to', () => {
    const board = 'XX..O....';
    expect(botMove(board, 'normal', always(0.99))).toBe(2);
    expect(botMove(board, 'hard', always(0.99))).toBe(2);
    expect(botMove(board, 'easy', always(0.99))).toBe(8);
  });

  it('Easy and Normal can be beaten', () => {
    // Easy (picking the first free square): a diagonal.
    let turn = playTurn(EMPTY_BOARD, 4, 'easy', always(0));
    turn = playTurn(turn!.board, 2, 'easy', always(0));
    turn = playTurn(turn!.board, 6, 'easy', always(0));
    expect(turn?.outcome).toBe('win');

    // Normal (playing loose on free moves): a fork on 3 and 4.
    turn = playTurn(EMPTY_BOARD, 0, 'normal', always(0.99));
    expect(turn?.board).toBe('X.......O');
    turn = playTurn(turn!.board, 2, 'normal', always(0.99));
    expect(turn?.board).toBe('XOX.....O');
    turn = playTurn(turn!.board, 6, 'normal', always(0.99));
    expect(turn?.board).toBe('XOXO..X.O');
    turn = playTurn(turn!.board, 4, 'normal', always(0.99));
    expect(turn?.outcome).toBe('win');
  });

  it('refuses a taken square, a square off the board and a finished game', () => {
    expect(playTurn('X...O....', 0, 'hard')).toBeNull();
    expect(playTurn(EMPTY_BOARD, 9, 'hard')).toBeNull();
    expect(playTurn('XXXOO....', 5, 'hard')).toBeNull();
  });

  it('ends in a draw when the last square fills without a line', () => {
    // X plays the last square: no line for anyone.
    expect(playTurn('XOXXOOOX.', 8, 'hard')).toEqual({ board: 'XOXXOOOXX', outcome: 'draw' });
  });

  it('lets the bot open when it starts', () => {
    expect(startBoard('hard', 'p')).toBe(EMPTY_BOARD);
    const opened = startBoard('normal', 'b', always(0.3));
    expect(opened.replace(/\./g, '')).toBe('O');
    expect(isPlayableBoard(opened, 'b')).toBe(true);
  });
});

describe('tic tac toe button IDs', () => {
  const ref: GameRef = { userId: '123456789012345678', difficulty: 'hard', starter: 'b', board: 'X...O...O' };

  it('round-trip and fit in a Discord custom ID', () => {
    expect(parseId(moveId(ref, 2))).toEqual({ action: 'move', ref, cell: 2 });
    expect(parseId(quitId(ref))).toEqual({ action: 'quit', ref });
    expect(parseId(againId(ref.userId, 'easy', 'p'))).toEqual({ action: 'again', userId: ref.userId, difficulty: 'easy', starter: 'p' });
    for (const id of [moveId(ref, 8), quitId(ref), againId(ref.userId, 'normal', 'b')]) expect(id.length).toBeLessThanOrEqual(100);
  });

  it('reject anything that is not a game', () => {
    expect(parseId('tcp-ttt:m:123456789012345678:zp:.........:1')).toBeNull();
    expect(parseId('tcp-ttt:m:123456789012345678:hp:XX.......:1')).toBeNull(); // not the member's turn
    expect(parseId('tcp-ttt:m:123456789012345678:hp:.........:9')).toBeNull();
    expect(parseId('tcp-tune:start')).toBeNull();
  });
});
