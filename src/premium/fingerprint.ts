// Every member's copy of the Premium script carries a fingerprint: one extra define line with an unused
// scrambled name and a random value, slipped in among the script's other defines. Defines that nothing uses
// change nothing when the script runs, and in the scrambled file the line looks like the hundreds around it.
// The bot keeps which member got which line, so a leaked copy can be traced back with /tcp trace.

export interface Mark {
  name: string;
  value: number;
}

// Lenient on spacing, so a copy someone re-saved or re-indented is still read.
const DEFINE_LINE = /^\s*define\s+(z[0-9a-f]+)\s*=\s*(-?\d+)\s*;/;
const NAME = /\bz[0-9a-f]+\b/g;
// The scrambler numbers names upwards from z0, so a new name is taken just above the file's highest one,
// where the next build's names would be, and values have three or four digits, like most of the file's own.
const NAME_SPREAD = 0x300;
const VALUE_MIN = 100;
const VALUE_MAX = 9999;

function lineBreak(text: string): string {
  return text.includes('\r\n') ? '\r\n' : '\n';
}

/** A fresh mark for this file: a name the file does not use and a pair nobody else has been given. */
export function newMark(text: string, taken: (mark: Mark) => boolean, random: () => number = Math.random): Mark {
  const used = new Set(text.match(NAME) ?? []);
  const highest = Math.max(0xff, ...[...used].map((name) => parseInt(name.slice(1), 16)));
  for (let attempt = 0; attempt < 10_000; attempt += 1) {
    const name = `z${(highest + 1 + Math.floor(random() * NAME_SPREAD)).toString(16)}`;
    const value = VALUE_MIN + Math.floor(random() * (VALUE_MAX - VALUE_MIN + 1));
    if (!used.has(name) && !taken({ name, value })) return { name, value };
  }
  throw new Error('No free fingerprint left for this file');
}

/** True when the mark can be stamped into this file: its name is not one the script already uses. */
export function markFits(text: string, mark: Mark): boolean {
  return !new Set(text.match(NAME) ?? []).has(mark.name);
}

/**
 * The file with the mark's define line added. Where it goes and how it is spaced follow from the mark, so
 * the same member always gets the same copy of the same upload.
 */
export function stampCopy(text: string, mark: Mark): string {
  const eol = lineBreak(text);
  const lines = text.split(eol);
  const defines = lines.flatMap((line, index) => (line.startsWith('define ') ? [index] : []));
  if (defines.length === 0) throw new Error('The script has no define lines to hide a fingerprint among');
  const at = defines[mark.value % defines.length]!;
  const spaces = ' '.repeat(1 + (Math.floor(mark.value / 7) % 4));
  lines.splice(at, 0, `define ${mark.name}${spaces}= ${mark.value};`);
  return lines.join(eol);
}

/** Every define in a file, as name and value, for matching against the marks the bot has handed out. */
export function definesIn(text: string): Mark[] {
  return text.split(/\r?\n/).flatMap((line) => {
    const match = DEFINE_LINE.exec(line);
    return match ? [{ name: match[1]!, value: Number(match[2]) }] : [];
  });
}
