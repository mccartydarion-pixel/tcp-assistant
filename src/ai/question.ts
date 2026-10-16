export interface UserQuestionDetails {
  topic?: string;
  symptom?: string;
  vertical?: number;
  horizontal?: number;
  adsSens?: number;
  precision?: number;
  response?: number;
  easing?: number;
  distance?: number;
  weapon?: string;
  optic?: string;
  /**
   * T.C.P Premium's Weapon Workshop: true when the player says a recorded pull is what fires (the PULL badge,
   * Scale Y or Scale X, a recorded pull or slot, Vertical Recoil that buzzes or is locked), false when they say
   * it is not (Weapon OFF, the STD badge, no recording yet, no Workshop). Vertical and Horizontal Recoil are
   * locked while a pull fires.
   */
  recordedPull?: boolean;
  /** The Workshop slot they name, W1 to W4. Naming a slot alone does not say it has a pull. */
  workshopSlot?: string;
  /** Workshop Scale Y (up/down) and Scale X (sideways), clamped to SCALE_MIN..SCALE_MAX. */
  scaleY?: number;
  scaleX?: number;
  /** The Scale they say they changed from: "from 100 to 110", "was 100 now 105", "100 -> 105". */
  previousScaleY?: number;
  previousScaleX?: number;
  /** The V and H numbers as the home screen shows them (V28 H4). On a recorded pull they are the pull that fires, not Vertical and Horizontal Recoil. */
  screenVertical?: number;
  screenHorizontal?: number;
}

/** Workshop Scale Y and Scale X on the Zen: 50 to 150%, default 100, one per press of Up/Down (ten with X held). */
export const SCALE_MIN = 50;
export const SCALE_MAX = 150;
export const SCALE_DEFAULT = 100;

export function clampScale(value: number): number {
  return Math.min(SCALE_MAX, Math.max(SCALE_MIN, Math.round(value)));
}

// Phone keyboards type curly apostrophes (weapon's off, but curly); the patterns below are written with straight ones.
const CURLY_APOSTROPHE = new RegExp(`[${String.fromCharCode(0x2018, 0x2019)}]`, 'g');
// Some players write a change with an arrow character: 100, arrow, 105.
const ARROW = String.fromCharCode(0x2192);

function straightApostrophes(text: string): string {
  return text.replace(CURLY_APOSTROPHE, "'");
}

// A badge named as a choice or ruled out ("PULL or STD?", "PULL not STD", "it doesn't say STD") is not what the
// screen shows, so it is taken out before the badge words are read. "no pull yet" stays: it is a clear signal.
const BADGE_CHOICE = /\b(?:pull|std)\s*(?:or|\/)\s*(?:pull|std)\b/gi;
const BADGE_RULED_OUT = /\b(?:not|no|isn'?t|is\s+not|instead\s+of|rather\s+than|(?:doesn'?t|does\s+not|don'?t|didn'?t|never)\s+(?:say|show|read)s?)\s+(?:the\s+|a\s+)?(?:pull|std)\b(?!\s+(?:yet|recorded|saved)\b)/gi;

// "off" that is not a setting: off target, off centre, off the mark.
const OFF_SETTING = String.raw`\boff\b(?!\s*(?:target|cent(?:er|re)|the\s+mark|to\s+the|course|by)\b)`;

// Said by a player whose recorded pull is not firing. These win over the signals below in the same message.
const PULL_OFF_SIGNALS: RegExp[] = [
  // "weapon off", "Weapon: OFF" (how the Workshop item reads), "weapon's off", "set weapon back to off".
  new RegExp(String.raw`\bweapon\b(?:'s)?[^.!?]{0,20}?${OFF_SETTING}`, 'i'),
  new RegExp(String.raw`\bworkshop\b(?:'s)?[^.!?]{0,20}?${OFF_SETTING}`, 'i'),
  /\bturn(?:ed|ing|s)?\s+off\s+(?:the\s+|my\s+)?(?:weapon|workshop)\b/i,
  /\bstd\b/i,
  /\b(?:no|without\s+(?:a|any)|don'?t\s+have\s+(?:a|any))\s+(?:recording|recorded\s+pull)s?\b/i,
  /\bno\s+pull\s+(?:yet|recorded|saved)\b/i,
  /\b(?:haven'?t|have\s+not|never|didn'?t|did\s+not|not)\s+(?:yet\s+)?record(?:ed)?\b/i,
  /\brecord\s+first\b/i,
  /\bempty\s+slot\b/i,
  // Scale Y and X only refuse Up/Down (buzz, RECORD FIRST) on a slot without a pull. Not the PULL: SCALE Y hint.
  /(?<!pull\s*:\s*)\bscale\s*[-_]?\s*[xy]\b[^.!?]{0,40}\bbuzz(?:es|ing|ed)?\b/i,
  // A player who has no Workshop (the free version) is not on a pull.
  /\b(?:no|without(?:\s+the)?|(?:don'?t|do\s+not|doesn'?t|does\s+not)\s+(?:have|has|show|see)(?:\s+(?:the|a|any))?|(?:can'?t|cannot|couldn'?t)\s+(?:see|find)(?:\s+the)?)\s+workshop\b/i,
  /\bworkshop\b[^.!?]{0,20}\b(?:missing|isn'?t\s+there|is\s+not\s+there|not\s+there|is\s+gone|not\s+showing)\b/i,
];

// "pull" as the home-screen badge, in any case, not the verb or the noun: not "pull down", "pull the trigger",
// "pull to the left" or "the pull is strong".
const BADGE_PULL = String.raw`pull\b(?!\s*(?:down|up|left|right|back|the|to|towards?|it|my|me|harder|more|less|enough|of|from|a|too|is|was|feels?|seems?)\b)`;

// Said by a player whose recorded pull fires.
const PULL_ON_SIGNALS: RegExp[] = [
  /\bpull\s+badge\b/i,
  new RegExp(String.raw`\bbadge\b[^.!?]{0,25}\b${BADGE_PULL}`, 'i'),
  new RegExp(String.raw`\b(?:shows?|showing|showed|says|said|saying|reads|displays?|displaying|home\s+screen|oled)\b[^.!?]{0,25}\b${BADGE_PULL}`, 'i'),
  // The home screen's "W1 M4-A1 PULL".
  new RegExp(String.raw`\bW[1-4]\b[^.!?]{0,30}\b${BADGE_PULL}`, 'i'),
  // Just "PULL" (or "it's pull"), the answer to "does it show PULL or STD?".
  /^\s*(?:it'?s\s+|it\s+is\s+|the\s+|mine\s+(?:is|says|shows)\s+)?pull(?:\s+badge)?\s*[.,!;]*\s*$/i,
  // The Vertical/Horizontal page's PULL: SCALE Y hint and the Calibrate page's PULL IN USE.
  /\bpull\s*:\s*scale\b/i,
  /\bpull\s+in\s+use\b/i,
  /\bscale\s*[-_]?\s*[xy]\b/i,
];

// A Workshop recording. Skipped when the message is about a video: "my recording" is then a clip for support.
const RECORDING_SIGNALS: RegExp[] = [
  /\brecorded\s+(?:a\s+|my\s+|the\s+|that\s+|this\s+)?(?:new\s+)?(?:pull|slot)s?\b/i,
  /\bmy\s+recordings?\b/i,
  /\b(?:recorded|recording)\b[^.!?]{0,30}\bW[1-4]\b/i,
  /\bW[1-4]\b[^.!?]{0,30}\b(?:recorded|recording)\b/i,
];
const VIDEO_CONTEXT = /\b(?:video|vids?|clips?|footage|obs|medal|youtube|youtu\.?be|streamable|twitch|shadowplay|outplayed|attached|attachment|screen\s*record\w*|watch|fps|bitrate|recording\s+(?:settings|software|app|quality))\b|\bhere(?:'s|\s+is)\s+(?:my|a|the)\s+recording\b/i;

// Vertical and Horizontal Recoil only refuse Up/Down (a long buzz) while a recorded pull fires, so a Vertical
// that buzzes or is locked is the plainest sign of one. Not "locked in" (dialled in), not "won't change anything".
const VERTICAL_LOCKED: RegExp[] = [
  /\b(?:vertical|horizontal)\b[^.!?]{0,40}\bbuzz(?:es|ing|ed)?\b/i,
  /\b(?:vertical|horizontal)\b[^.!?]{0,40}\blocked\b(?!\s+in\b)/i,
  /\b(?:vertical|horizontal)\b(?:\s+recoil)?\s+(?:is\s+|it'?s\s+|stays\s+|keeps\s+)?stuck\b/i,
  /\b(?:vertical|horizontal)\b[^.!?]{0,40}\bstuck\s+(?:at|on)\s+-?\d/i,
  /\b(?:vertical|horizontal)\b[^.!?]{0,40}\bwon'?t\s+(?:change|go\s+(?:up|down)|move|budge)\b(?!\s+(?:anything|much|a\s+thing|the|my|how|it)\b)/i,
  /\b(?:vertical|horizontal)\b[^.!?]{0,40}\b(?:can'?t|cannot)\s+(?:change|raise|lower|adjust)\s+it\b/i,
];
// ...but the Master hold (L3 + R3), Calibrate and the licence lock buzz or lock too.
const NOT_THE_PULL_LOCK = /\b(?:l3|r3|ls|rs|master|calibrat\w*|licen[cs]e|unlock|lock\s+screen|code)\b/i;

export function detectRecordedPull(question: string): boolean | undefined {
  const text = straightApostrophes(question).replace(BADGE_CHOICE, ' ').replace(BADGE_RULED_OUT, ' ');
  if (PULL_OFF_SIGNALS.some((pattern) => pattern.test(text))) return false;
  if (PULL_ON_SIGNALS.some((pattern) => pattern.test(text))) return true;
  if (!VIDEO_CONTEXT.test(text) && RECORDING_SIGNALS.some((pattern) => pattern.test(text))) return true;
  if (!NOT_THE_PULL_LOCK.test(text) && VERTICAL_LOCKED.some((pattern) => pattern.test(text))) return true;
  return undefined;
}

// Between "scale y" and its number: "scale y is now at 110", "scale y's at 95%", "scale y went from 100".
const SCALE_LEAD = String.raw`(?:'s)?\s*(?:(?:is|was|at|to|of|now|on|currently|still|already|set|went|from|back|around|about|(?:up|down)\s+to)\b\s*|[=:]\s*)*`;
// A number, but not a page position (4/6) and not the start of a longer number.
const SCALE_NUMBER = String.raw`(\d+(?:\.\d+)?)(?!\d|\.\d|\s*\/)\s*%?`;
// A second number is the one set now: "from 100 to 110", "was 100 now 105", "100 -> 105".
const SCALE_THEN = String.raw`(?:\s*(?:->|${ARROW}|=>|,?\s*(?:and\s+)?(?:now|then)(?:\s+(?:at|is|to))?|to)\s*${SCALE_NUMBER})?`;
// A value asked about in the same clause ("should i raise scale y to 110?") is not the value set.
const ASKING = /\b(?:should|shall|can|could|would|will|do)\s+(?:i|we)\b|\bwhat\s+(?:if|about)\b|\bhow\s+about\b/i;

function readScale(input: string, axis: 'x' | 'y'): { value?: number; previous?: number } {
  const question = straightApostrophes(input);
  const pattern = new RegExp(String.raw`\bscale\s*[-_]?\s*${axis}\b${SCALE_LEAD}${SCALE_NUMBER}${SCALE_THEN}`, 'gi');
  let found: RegExpMatchArray | undefined;
  // The last mention that is not a question is the current value.
  for (const match of question.matchAll(pattern)) {
    const clause = question.slice(0, match.index).split(/[.!?,;]/).pop() ?? '';
    if (!ASKING.test(clause)) found = match;
  }
  if (!found?.[1]) return {};
  if (found[2]) return { value: clampScale(Number(found[2])), previous: clampScale(Number(found[1])) };
  return { value: clampScale(Number(found[1])) };
}

function readScreenPull(question: string): { screenVertical?: number; screenHorizontal?: number } {
  const pair = question.match(/\bV\s?(\d{1,3})\s*[,/|]?\s*H\s?(-?\d{1,3})\b/i);
  if (pair?.[1] && pair[2]) return { screenVertical: Number(pair[1]), screenHorizontal: Number(pair[2]) };
  // A lone V or H number. A lone V needs two digits, so a version (v2, the v5 script, v2.0) is not read as a pull.
  return {
    screenVertical: readNumber(question, /\bV\s?(\d{2,3})\b(?!\.\d)/i),
    screenHorizontal: readNumber(question, /\bH\s?(-?\d{1,3})\b(?!\.\d)/i),
  };
}

export function normalizeUserQuestion(input: string, botId?: string): string {
  const withoutMention = botId ? input.replace(new RegExp(`<@!?${botId}>`, 'g'), '') : input;
  return withoutMention.replace(/\s+/g, ' ').trim();
}

export function extractQuestionDetails(question: string): UserQuestionDetails {
  const lower = question.toLowerCase();
  const details: UserQuestionDetails = {};

  if (/ads|aim|tracking|shaky|precision|response|easing/.test(lower)) details.topic = 'ads_accuracy';
  else if (/horizontal|pulling left|pull left|pulling right|pull right/.test(lower)) details.topic = 'horizontal_recoil';
  else if (/vertical|going up|climb|recoil|gun/.test(lower)) details.topic = 'anti_recoil';

  if (/going up|climb|upward/.test(lower)) details.symptom = 'upward_climb';
  else if (/pull(?:ing)? left/.test(lower)) details.symptom = 'left_pull';
  else if (/pull(?:ing)? right/.test(lower)) details.symptom = 'right_pull';
  else if (/shaky|unstable|micro aim/.test(lower)) details.symptom = 'unstable_micro_aim';
  else if (/slow|heavy/.test(lower)) details.symptom = 'slow_ads';
  else if (/overcorrect/.test(lower)) details.symptom = 'overcorrection';

  details.vertical = readNumber(question, /\bvertical\s*(?:is|=|:)??\s*(-?\d+(?:\.\d+)?)/i);
  details.horizontal = readNumber(question, /\bhorizontal\s*(?:is|=|:)??\s*(-?\d+(?:\.\d+)?)/i);
  details.adsSens = readNumber(question, /\bads\s*(?:sens|sensitivity)\s*(?:is|=|:)??\s*(\d+(?:\.\d+)?)/i);
  details.precision = readNumber(question, /\bprecision\s*(?:is|=|:)??\s*(\d+(?:\.\d+)?)/i);
  details.response = readNumber(question, /\bresponse\s*(?:is|=|:)??\s*(\d+(?:\.\d+)?)/i);
  details.easing = readNumber(question, /\beasing\s*(?:is|=|:)??\s*(\d+(?:\.\d+)?)/i);
  details.distance = readNumber(question, /\b(\d+(?:\.\d+)?)\s*(?:m|meters?)\b/i);

  const weapon = question.match(/\b(?:weapon|gun)\s*(?:is|=|:)\s*([\w-]+)/i)?.[1];
  const optic = question.match(/\b(?:optic|scope)\s*(?:is|=|:)\s*([\w-]+)/i)?.[1];
  // "Weapon: OFF" is the Workshop item, not a gun.
  if (weapon && !/^(?:off|on)$/i.test(weapon)) details.weapon = weapon;
  if (optic) details.optic = optic;

  details.recordedPull = detectRecordedPull(question);
  const slot = question.match(/\bW([1-4])\b/i)?.[1];
  if (slot) details.workshopSlot = `W${slot}`;
  const scaleY = readScale(question, 'y');
  details.scaleY = scaleY.value;
  details.previousScaleY = scaleY.previous;
  const scaleX = readScale(question, 'x');
  details.scaleX = scaleX.value;
  details.previousScaleX = scaleX.previous;
  Object.assign(details, readScreenPull(question));

  return Object.fromEntries(Object.entries(details).filter(([, value]) => value !== undefined)) as UserQuestionDetails;
}

function readNumber(input: string, pattern: RegExp): number | undefined {
  const match = input.match(pattern);
  return match?.[1] ? Number(match[1]) : undefined;
}
