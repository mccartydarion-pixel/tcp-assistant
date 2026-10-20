import type { KnowledgeChunk, RetrievalResult } from './types.js';

// Words players use, expanded to the headings in knowledge/T.C.P_DOCUMENTATION.md. Words that already
// appear in a heading (lean, precision, recoil, easing...) need no entry; mapping them would pull every
// question that mentions them toward one section.
const aliasMap: Record<string, string> = {
  // Weapon Workshop (T.C.P Premium). This block comes first: aliases are applied in order, and some of
  // these phrases contain words expanded further down ("vertical", "locked" -> licence, "profile").
  // Every Workshop chunk shares the section name "Weapon Workshop (Premium)" and matching is by substring,
  // so the first entries keep everyday words out of it: "work" and "works" are inside "workshop" ("drop
  // shot doesn't work"), "weapon" is in the name ("my weapon climbs" belongs with "Gun climbs during a
  // burst"), and "premium" questions (price, what it includes) go to Versions.
  work: 'working',
  works: 'working',
  // "lot" and "lots" are inside "slots" ("my aim shakes a lot").
  lot: 'much',
  lots: 'many',
  // With "work" changed, "does it work on ps4" no longer finds "works with a PlayStation" in the Overview.
  ps4: 'playstation ps4',
  ps5: 'playstation ps5',
  // Asking for the Premium file itself is a download question, not one about what Premium is.
  'premium file': 'download premium script',
  premium: 'licensed versions',
  // "clear" is in a Workshop heading, but clearing every setting is a factory reset.
  'clear my settings': 'factory reset settings',
  'clear all settings': 'factory reset settings',
  'clear all my settings': 'factory reset settings',
  'clear settings': 'factory reset settings',
  'weapon sway': 'sway',
  'weapon profile': 'workshop',
  'weapon profiles': 'workshop',
  'weapon off': 'workshop slot off',
  weapon: 'gun',
  // From here on "weapon" reads "gun".
  'gun profile': 'workshop',
  'gun profiles': 'workshop',
  'gun slot': 'workshop slots',
  'gun slots': 'workshop slots',
  // The bot adds "anti_recoil" to any question that mentions a gun, recoil or vertical, and that pair
  // matches the Anti-Recoil headings; so indirect Workshop phrasings expand to a Workshop heading pair
  // ("weapon workshop", "workshop recording", "workshop switching", "redo clear", "scale y") to come out
  // ahead of it. Broader phrases ("vertical wont", "change gun", "recoil for my", "change horizontal")
  // were tried and left out: they pull ordinary questions ("vertical won't save", "change gun
  // sensitivity", "a good recoil for my m4", "how do i change horizontal") into the Workshop.
  'each gun': 'weapon workshop recording each gun',
  'per gun': 'weapon workshop recording per gun',
  'different guns': 'weapon workshop recording different guns',
  // Not plain "different recoil": "why does my gun have different recoil every spray" is about DayZ's
  // random recoil (Limits).
  'different recoil for': 'weapon workshop recording different recoil for',
  'different recoil per': 'weapon workshop recording different recoil per',
  'different recoils': 'weapon workshop recording different recoils',
  'between guns': 'workshop switching slots',
  'changing guns': 'workshop switching slots',
  'switching guns': 'workshop switching slots',
  'how many guns': 'workshop redo clear four slots',
  'gun list': 'workshop recording step gun list',
  // The Mag item (rounds in the slot's magazine) is a step of the recording walkthrough. The replacements
  // say "mag", never "magazine", so the "magazine" entries below cannot expand them again; "mag" alone stays
  // as it is ("full mag" and "rnd mag" are card words, further down).
  'mag item': 'workshop recording step mag item',
  'mag setting': 'workshop recording step mag',
  'mag size': 'workshop recording step mag',
  'mag sizes': 'workshop recording step mag',
  'mag option': 'workshop recording step mag',
  'mag do': 'workshop recording step mag',
  'set mag': 'workshop recording step mag',
  'set the mag': 'workshop recording step mag',
  'change mag': 'workshop recording step mag',
  'change the mag': 'workshop recording step mag',
  'magazine size': 'workshop recording step mag',
  'magazine sizes': 'workshop recording step mag',
  'how many rounds': 'workshop recording step mag rounds',
  'round mag': 'workshop recording step mag',
  'round mags': 'workshop recording step mag',
  'round magazine': 'workshop recording step mag',
  'round magazines': 'workshop recording step mag',
  'extended mag': 'workshop recording step mag',
  'bigger mag': 'workshop recording step mag',
  'drum mag': 'workshop recording step mag',
  'my mag': 'workshop recording step mag',
  'the mag': 'workshop recording step mag',
  'mag matter': 'workshop recording step mag',
  magazine: 'workshop recording step magazine',
  // How the Mag item reads, "30 RND 2.0S": without this the "2.0" finds ADS Accuracy 2.0.
  ...Object.fromEntries(Array.from({ length: 10 }, (_, digit) => [`rnd ${digit}`, 'workshop recording step mag rnd'])),
  // Updating to the build with the Mag item empties the Workshop once.
  'workshop is empty': 'workshop redo clear four slots empties',
  'workshop empty': 'workshop redo clear four slots empties',
  'slots are empty': 'workshop redo clear four slots empties',
  'recordings are gone': 'workshop redo clear four slots empties',
  'recordings gone': 'workshop redo clear four slots empties',
  'lost my recordings': 'workshop redo clear four slots empties',
  'recorded pull': 'workshop scale y scale x recorded pull',
  'saved pull': 'workshop scale y scale x recorded pull',
  'recorded recoil': 'workshop scale y scale x recorded pull',
  'saved recoil': 'workshop scale y scale x recorded pull',
  'delete a recording': 'workshop redo clear',
  'delete my recording': 'workshop redo clear',
  'delete the recording': 'workshop redo clear',
  'delete recording': 'workshop redo clear',
  'delete recordings': 'workshop redo clear',
  'remove a recording': 'workshop redo clear',
  'remove my recording': 'workshop redo clear',
  'delete a slot': 'workshop redo clear',
  'reset a slot': 'workshop redo clear',
  'reset the slot': 'workshop redo clear',
  'vertical recoil is stuck': 'workshop scale y scale x vertical locked',
  'vertical recoil stuck': 'workshop scale y scale x vertical locked',
  'vertical recoil wont change': 'workshop scale y scale x vertical locked',
  "vertical recoil won't change": 'workshop scale y scale x vertical locked',
  'vertical recoil wont go up': 'workshop scale y scale x vertical locked',
  "vertical recoil won't go up": 'workshop scale y scale x vertical locked',
  'vertical is stuck': 'workshop scale y scale x vertical locked',
  'vertical stuck': 'workshop scale y scale x vertical locked',
  'vertical buzz': 'workshop scale y scale x vertical locked',
  'vertical buzzes': 'workshop scale y scale x vertical locked',
  'vertical wont change': 'workshop scale y scale x vertical locked',
  "vertical won't change": 'workshop scale y scale x vertical locked',
  'vertical wont go up': 'workshop scale y scale x vertical locked',
  "vertical won't go up": 'workshop scale y scale x vertical locked',
  'vertical number wont': 'workshop scale y scale x vertical locked',
  "vertical number won't": 'workshop scale y scale x vertical locked',
  'horizontal recoil is stuck': 'workshop scale y scale x horizontal locked',
  'horizontal recoil wont change': 'workshop scale y scale x horizontal locked',
  "horizontal recoil won't change": 'workshop scale y scale x horizontal locked',
  'horizontal is stuck': 'workshop scale y scale x horizontal locked',
  'horizontal stuck': 'workshop scale y scale x horizontal locked',
  'horizontal wont change': 'workshop scale y scale x horizontal locked',
  "horizontal won't change": 'workshop scale y scale x horizontal locked',
  'horizontal buzzes': 'workshop scale y scale x horizontal locked',
  'back to normal vertical': 'workshop switching slots weapon off',
  std: 'workshop switching slots badge std',
  "gun isn't on the list": 'workshop recording step gun list other',
  "gun isn't in the list": 'workshop recording step gun list other',
  'gun isnt on the list': 'workshop recording step gun list other',
  'gun isnt in the list': 'workshop recording step gun list other',
  'gun is not on the list': 'workshop recording step gun list other',
  'gun is not in the list': 'workshop recording step gun list other',
  'gun not on the list': 'workshop recording step gun list other',
  'gun not in the list': 'workshop recording step gun list other',
  'same gun': 'workshop four slots',
  'how many slots': 'workshop four slots',
  w1: 'workshop slots',
  w2: 'workshop slots',
  w3: 'workshop slots',
  w4: 'workshop slots',
  'switch gun': 'workshop switching slots',
  'switch guns': 'workshop switching slots',
  'change guns': 'workshop switching slots',
  'swap gun': 'workshop switching slots',
  'swap guns': 'workshop switching slots',
  'scale y': 'workshop scale y',
  'scale x': 'workshop scale x',
  // Vertical and Horizontal Recoil are locked while a slot with a recorded pull is selected; Scale Y and
  // Scale X are what to use instead.
  'vertical recoil is locked': 'workshop scale y scale x',
  'vertical is locked': 'workshop scale y scale x',
  'vertical recoil locked': 'workshop scale y scale x',
  'vertical locked': 'workshop scale y scale x',
  'horizontal recoil is locked': 'workshop scale y scale x',
  'horizontal is locked': 'workshop scale y scale x',
  'horizontal recoil locked': 'workshop scale y scale x',
  'horizontal locked': 'workshop scale y scale x',
  "can't change vertical": 'workshop scale y scale x',
  'cant change vertical': 'workshop scale y scale x',
  "can't change horizontal": 'workshop scale y scale x',
  'cant change horizontal': 'workshop scale y scale x',
  'cant i change vertical': 'workshop scale y scale x',
  "can't i change vertical": 'workshop scale y scale x',
  'cannot change vertical': 'workshop scale y scale x',
  'cant i change horizontal': 'workshop scale y scale x',
  "can't i change horizontal": 'workshop scale y scale x',
  'cannot change horizontal': 'workshop scale y scale x',
  // Words from the recorder card: the words stay and the heading is added. Everyday phrases such as
  // "too short", "vertical up" or "cancelled" only count after "says" or before "mean".
  'stick moved': 'workshop messages stick moved',
  'off pattern': 'workshop messages off pattern',
  'hold longer': 'workshop messages hold longer',
  'full mag': 'workshop messages full mag',
  'rnd mag': 'workshop messages rnd mag',
  'aim first': 'workshop messages aim first',
  'aim lost': 'workshop messages aim lost',
  'says too short': 'workshop messages too short',
  'saying too short': 'workshop messages too short',
  'too short mean': 'workshop messages too short',
  'says vertical up': 'workshop messages recorder card',
  'saying vertical up': 'workshop messages recorder card',
  'vertical up mean': 'workshop messages recorder card',
  'says cancelled': 'workshop messages cancelled',
  'cancelled mean': 'workshop messages cancelled',
  'stopped not saved': 'workshop messages stopped not saved',
  'stopped / not saved': 'workshop messages stopped not saved',
  'stopped/not saved': 'workshop messages stopped not saved',
  'says not saved': 'workshop messages stopped not saved',
  'pull in use': 'workshop messages pull in use',
  'nothing to clear': 'workshop messages nothing to clear',
  discarded: 'workshop messages discarded',
  'says master is off': 'workshop messages master is off',
  'saying master is off': 'workshop messages master is off',
  'master is off mean': 'workshop messages master is off',
  'aim at mark': 'workshop messages aim at mark',
  'aim at the mark mean': 'workshop messages aim at mark',
  'fire a mag': 'workshop messages fire a mag',
  'until empty': 'workshop messages until empty',
  'says keep aiming': 'workshop messages keep aiming',
  'says replaces': 'workshop messages replaces',
  'replaces mean': 'workshop messages replaces',
  'says accepted': 'workshop messages accepted',
  'accepted mean': 'workshop messages accepted',
  // Not "armed mean": the boot screen says SYSTEMS ARMED.
  'says armed': 'workshop messages armed',
  'says ready': 'workshop messages ready',
  'ready mean': 'workshop messages ready',
  'says empty': 'workshop messages empty',
  'pause mark': 'workshop messages pause mark',
  'drop+lean': 'workshop messages pause mark',
  vss: 'workshop vss',
  sval: 'workshop sval',
  badge: 'workshop switching slots badge',
  badges: 'workshop switching slots badge',
  recordings: 'workshop recordings',
  'recording stopped': 'workshop messages stopped not saved',
  'recording stops': 'workshop messages stopped not saved',
  'recording keeps stopping': 'workshop messages stopped not saved',
  'recording wont save': 'workshop messages stopped not saved',
  "recording won't save": 'workshop messages stopped not saved',
  'recording doesnt save': 'workshop messages stopped not saved',
  "recording doesn't save": 'workshop messages stopped not saved',
  'recording didnt save': 'workshop messages stopped not saved',
  "recording didn't save": 'workshop messages stopped not saved',
  'recording not saving': 'workshop messages stopped not saved',
  record: 'workshop recording',
  'redo a gun': 'workshop redo clear',
  'redo my gun': 'workshop redo clear',
  'redo the gun': 'workshop redo clear',
  'redo a slot': 'workshop redo clear',
  'redo my slot': 'workshop redo clear',
  'redo the slot': 'workshop redo clear',
  redo: 'workshop redo',
  'buzzes mean': 'workshop buzzes',
  'buzz mean': 'workshop buzzes',
  'buzzes when recording': 'workshop buzzes',
  'buzzes while recording': 'workshop buzzes',
  'long buzz': 'workshop buzzes long',
  'long buzzes': 'workshop buzzes long',
  'short buzz': 'workshop buzzes short',
  'short buzzes': 'workshop buzzes short',
  'while recording': 'workshop notes recording',
  ar: 'Anti-Recoil',
  'anti recoil': 'Anti-Recoil',
  'stable core': 'Anti-Recoil',
  vert: 'Vertical Recoil',
  vertical: 'Vertical Recoil',
  hori: 'Horizontal Recoil',
  horizontal: 'Horizontal Recoil',
  ads: 'ADS Accuracy',
  'auto aim': 'Automatic Aim',
  reset: 'Factory Reset',
  calibrate: 'Calibrate Recoil',
  calibration: 'Calibrate Recoil',
  'turn strenght': 'Turn Strength',
  'turn strengh': 'Turn Strength',
  'turning strength': 'Turn Strength',
  turnstrength: 'Turn Strength',
  firesens: 'Fire Sens',
  profile: 'ADS Profiles',
  profiles: 'ADS Profiles',
  dropshot: 'Drop Shot',
  crouchshot: 'Crouch Shot',
  // Double Tap is an item of Drop Shot, not a heading of its own; keep the words and add the heading.
  'double tap': 'Drop Shot Double Tap',
  'double-tap': 'Drop Shot Double Tap',
  doubletap: 'Drop Shot Double Tap',
  'double tapping': 'Drop Shot Double Tap',
  moonwalk: 'Auto Movement',
  adz: 'Anti Deadzone',
  mie: 'Motion Intel',
  'motion intelligence': 'Motion Intel',
  license: 'Licence Unlock',
  licence: 'Licence Unlock',
  unlock: 'Licence Unlock',
  key: 'Licence Unlock',
  generate: 'Licence Unlock',
  trial: 'Free Trial',
  locked: 'Licence Unlock',
};

export interface KnowledgeRetriever {
  search(query: string, limit?: number): Promise<RetrievalResult[]>;
}

export class KeywordRetriever implements KnowledgeRetriever {
  constructor(private readonly chunks: KnowledgeChunk[]) {}

  async search(query: string, limit = 5): Promise<RetrievalResult[]> {
    const tokens = normalizeQuery(query);

    const scored = this.chunks
      .map((chunk) => {
        const score = scoreChunk(chunk, tokens);
        return score > 0 ? { chunk, score } : null;
      })
      .filter(Boolean) as RetrievalResult[];

    return scored.sort((a, b) => b.score - a.score).slice(0, limit);
  }
}

function normalizeQuery(input: string): string[] {
  const lower = input.toLowerCase();
  let expanded = lower;

  for (const [alias, replacement] of Object.entries(aliasMap)) {
    expanded = expanded.replace(new RegExp(`\\b${escapeRegex(alias)}\\b`, 'g'), replacement.toLowerCase());
  }

  // Matching is by substring, so a two-letter word like "do" would match "down" anywhere. Numbers stay
  // (players ask about "180").
  const tokens = (expanded.match(/[a-z0-9]+/g) ?? []).filter(
    (token) => !STOP_WORDS.has(token) && (token.length >= 3 || /^\d+$/.test(token)),
  );
  return tokens;
}

function scoreChunk(chunk: KnowledgeChunk, tokens: string[]): number {
  const haystack = [
    chunk.section,
    chunk.subsection ?? '',
    chunk.heading,
    chunk.content,
    chunk.keywords.join(' '),
  ]
    .join(' ')
    .toLowerCase();

  let score = 0;

  for (const token of tokens) {
    if (haystack.includes(token)) score += 2;
    if (chunk.section.toLowerCase().includes(token) || chunk.heading.toLowerCase().includes(token)) score += 4;
  }

  if (tokens.some((token) => chunk.section.toLowerCase().includes(token))) score += 10;
  if (tokens.some((token) => chunk.heading.toLowerCase().includes(token))) score += 8;

  // Two words of the question side by side in the heading ("anti deadzone", "fire sens", "lean spam")
  // is a strong sign this is the section being asked about.
  const heading = chunk.heading.toLowerCase().replace(/[^a-z0-9]+/g, ' ');
  for (let index = 0; index + 1 < tokens.length; index += 1) {
    if (heading.includes(`${tokens[index]} ${tokens[index + 1]}`)) score += 12;
  }

  // Favour the recoil sections for recoil questions only; applied to every question, this would make
  // any section that mentions recoil a match for unrelated questions.
  const recoilQuestion = tokens.some((token) => ['vertical', 'horizontal', 'recoil'].includes(token));
  if (score > 0 && recoilQuestion && ['vertical', 'horizontal', 'anti-recoil', 'anti recoil'].some((term) => haystack.includes(term))) {
    score += 5;
  }

  return score;
}

const STOP_WORDS = new Set([
  'the', 'what', 'does', 'how', 'why', 'can', 'is', 'a', 'an', 'my', 'it', 'for', 'and', 'or', 'to', 'of', 'in', 'on',
  'you', 'your', 'with', 'this', 'that', 'when', 'should', 'would', 'keeps', 'not', 'doesnt', 'dont', 'get', 'has', 'have',
]);

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
