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

  return Object.fromEntries(Object.entries(details).filter(([, value]) => value !== undefined)) as UserQuestionDetails;
}

function readNumber(input: string, pattern: RegExp): number | undefined {
  const match = input.match(pattern);
  return match?.[1] ? Number(match[1]) : undefined;
}
