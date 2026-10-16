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
   * T.C.P Premium's Weapon Workshop: true when the player says a recorded pull is what fires (PULL badge, Scale Y
   * or Scale X, a W1-W4 slot, "recorded pull", "my recording", the Workshop), false when they say it is not
   * (Weapon OFF, the STD badge, no recording yet). Vertical and Horizontal Recoil are locked while a pull fires.
   */
  recordedPull?: boolean;
  /** The Workshop slot they name, W1 to W4. */
  workshopSlot?: string;
  /** Workshop Scale Y (up/down) and Scale X (sideways), clamped to SCALE_MIN..SCALE_MAX. */
  scaleY?: number;
  scaleX?: number;
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

// Said by a player whose recorded pull is not firing. These win over the signals below in the same message.
const PULL_OFF_SIGNALS: RegExp[] = [
  /\bweapon\s+(?:slot\s+)?(?:(?:is|to|on|at|set\s+to|=|:)\s*)?off\b/i,
  /\bstd\b/i,
  /\b(?:no|without\s+(?:a|any)|don'?t\s+have\s+(?:a|any))\s+(?:recording|recorded\s+pull)s?\b/i,
  /\b(?:haven'?t|have\s+not|never|didn'?t|did\s+not|not)\s+(?:yet\s+)?record(?:ed)?\b/i,
  /\brecord\s+first\b/i,
  /\bempty\s+slot\b/i,
];

// Said by a player whose recorded pull fires. PULL in capitals is the home-screen badge and the PULL: SCALE Y
// hint as the Zen writes them, not "PULL DOWN".
const PULL_ON_SIGNALS: RegExp[] = [
  /\bpull\s+badge\b/i,
  /\bbadge\s+(?:says|shows|is|reads)\s+pull\b/i,
  /\bPULL\b(?!\s*(?:DOWN|UP|LEFT|RIGHT|BACK)\b)/,
  /\brecorded\s+(?:a\s+|my\s+|the\s+|that\s+)?(?:pull|slot|gun|weapon|spray)s?\b/i,
  /\bmy\s+recordings?\b/i,
  /\bscale\s*[-_]?\s*[xy]\b/i,
  /\bW[1-4]\b/i,
];

// "Workshop" counts too, but not in a question about the feature itself (what or where it is, whether it is free).
const WORKSHOP_ABOUT = /\b(?:what(?:'s|\s+is|\s+does)|where(?:'s|\s+is)|is\s+(?:the\s+)?workshop|does\s+(?:the\s+)?workshop|can'?t\s+find|cannot\s+find|don'?t\s+(?:have|see)|do\s+not\s+(?:have|see)|free|premium|price|cost|buy|unlock)\b/i;

export function detectRecordedPull(question: string): boolean | undefined {
  if (PULL_OFF_SIGNALS.some((pattern) => pattern.test(question))) return false;
  if (PULL_ON_SIGNALS.some((pattern) => pattern.test(question))) return true;
  if (/\bworkshop\b/i.test(question) && !WORKSHOP_ABOUT.test(question)) return true;
  return undefined;
}

function readScale(question: string, axis: 'x' | 'y'): number | undefined {
  // "scale y 110", "scale y is 105", "scale y at 95%", "scale y is now at 100"; not "scale y (4/6)" or "scale y by 5".
  const pattern = new RegExp(`\\bscale\\s*[-_]?\\s*${axis}\\b\\s*(?:(?:is|=|:|at|to|of|now|on|currently|set\\s+to)\\s*)*(\\d+(?:\\.\\d+)?)\\b(?!\\s*\\/)`, 'i');
  const value = readNumber(question, pattern);
  return value === undefined ? undefined : clampScale(value);
}

function readScreenPull(question: string): { screenVertical?: number; screenHorizontal?: number } {
  const pair = question.match(/\bV\s?(\d{1,3})\s*[,/|]?\s*H\s?(-?\d{1,3})\b/i);
  if (pair?.[1] && pair[2]) return { screenVertical: Number(pair[1]), screenHorizontal: Number(pair[2]) };
  // A lone V or H number, but not a version such as v2.0.
  return {
    screenVertical: readNumber(question, /\bV\s?(\d{1,3})\b(?![.\d])/i),
    screenHorizontal: readNumber(question, /\bH\s?(-?\d{1,3})\b(?![.\d])/i),
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
  if (weapon) details.weapon = weapon;
  if (optic) details.optic = optic;

  details.recordedPull = detectRecordedPull(question);
  const slot = question.match(/\bW([1-4])\b/i)?.[1];
  if (slot) details.workshopSlot = `W${slot}`;
  details.scaleY = readScale(question, 'y');
  details.scaleX = readScale(question, 'x');
  Object.assign(details, readScreenPull(question));

  return Object.fromEntries(Object.entries(details).filter(([, value]) => value !== undefined)) as UserQuestionDetails;
}

function readNumber(input: string, pattern: RegExp): number | undefined {
  const match = input.match(pattern);
  return match?.[1] ? Number(match[1]) : undefined;
}
