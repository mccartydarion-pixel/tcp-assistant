import { getStateStrict, setState } from './stateStore.js';

/**
 * One JSON value in the bot_state table that several features change: every change runs one at a time (two
 * changes made together both land), and the value is read strictly, so a value that cannot be read is never
 * written over with an empty one.
 */
export function jsonStore<T>(key: string, empty: () => T) {
  let queue: Promise<unknown> = Promise.resolve();
  return {
    /** Changes the value; throws when it cannot be read or saved. */
    update<R>(change: (value: T, now: number) => R): Promise<R> {
      const run = queue.then(async () => {
        const value = (await getStateStrict<T>(key)) ?? empty();
        const result = change(value, Date.now());
        await setState(key, value);
        return result;
      });
      queue = run.catch(() => undefined);
      return run;
    },
    /** The value once the changes already asked for have landed. Throws when it cannot be read. */
    async read(): Promise<T> {
      await queue;
      return (await getStateStrict<T>(key)) ?? empty();
    },
  };
}
