// Members write in many languages. The documentation is English and the search is by English keywords, so a
// question that is not in English is translated for the search only; the assistant still reads the
// member's own words and answers in their language (the system prompt says so).

const ENGLISH = new Set(
  "the a an is are was be to of and or in on at it my me i you your we our how what why when where which do does did not no can cant cannot will with for from this that there have has get got after before still just like feel feels im i'm ive i've new help please thanks thank hi hello hey need want know any but if about here they them should would could keep keeps work works working dont don't doesnt doesn't isnt isn't wont won't".split(
    ' ',
  ),
);
// Common words of the languages the server sees most, none of them English words.
const FOREIGN = new Set(
  [
    // Spanish
    'el la los las que de del por para como funciona tengo pero cuando mi mis esta está estoy hace tiene muy porque también configuracion configuración',
    // Portuguese
    'não nao você voce meu minha está com uma um porque quando tenho funciona configuração muito também',
    // French
    'le les des est pas avec pour mon ma mes je vous ça fonctionne quand pourquoi aussi',
    // German
    'ich nicht mit und ist das die der wie mein meine funktioniert wenn warum auch habe',
    // Italian
    'non che il della funziona perché quando anche ho',
  ]
    .join(' ')
    .split(' '),
);

/** Whether a message is probably not English: another alphabet, accented letters, or other languages' common words and no English ones. */
export function looksNonEnglish(text: string): boolean {
  const letters = text.replace(/<[@#&!]?\d+>/g, '');
  if (/[Ѐ-ӿ؀-ۿ֐-׿぀-ヿ一-鿿가-힯฀-๿]/.test(letters)) return true;
  const words = letters.toLowerCase().match(/[\p{L}']+/gu) ?? [];
  if (words.length < 3) return false;
  const english = words.filter((word) => ENGLISH.has(word)).length;
  const foreign = words.filter((word) => FOREIGN.has(word)).length;
  if (/[áéíóúñãõçàèìòùâêôûäöüßœ¿¡]/i.test(letters) && english <= foreign) return true;
  return foreign >= 2 && english === 0 ? true : foreign > english * 2 && foreign >= 2;
}

/**
 * The language to answer in, decided here and handed to the model as an order. Left to the model, a ticket
 * that said only "im new" got a Spanish reply (2026-11-10), and then a made-up "since you wrote in Spanish".
 * 'unclear' (three or more words, none of them common English ones, and not clearly another language) leaves
 * it to the model, English when it cannot tell.
 */
export type ReplyLanguage = 'english' | 'member' | 'unclear';

// "English please", also when asked in another language (inglés, inglês, anglais, Englisch, inglese).
const ENGLISH_REQUEST = /\b(english|ingl[eéê]s|anglais|englisch|inglese)\b/i;
const ACCENTED = /[áéíóúñãõçàèìòùâêôûäöüßœ¿¡]/i;
const TOO_SHORT = 3;

/** One message's verdict, or null when it is too short to tell. */
function verdictOf(text: string): ReplyLanguage | null {
  if (ENGLISH_REQUEST.test(text)) return 'english';
  if (looksNonEnglish(text)) return 'member';
  const words = text.replace(/<[@#&!]?\d+>/g, '').toLowerCase().match(/[\p{L}']+/gu) ?? [];
  const english = words.filter((word) => ENGLISH.has(word)).length;
  if (ACCENTED.test(text) && english === 0) return 'member';
  if (words.length < TOO_SHORT) return null;
  const foreign = words.filter((word) => FOREIGN.has(word)).length;
  return english > 0 && english >= foreign ? 'english' : 'unclear';
}

/**
 * The language to reply in: English unless the message clearly is not. Asking for English always gives
 * English. A message too short to tell ("im new", "ok", "thanks") follows the member's last earlier message
 * that could be told, and is English when there is none.
 */
export function replyLanguage(question: string, earlierQuestions: string[] = []): ReplyLanguage {
  const own = verdictOf(question);
  if (own) return own;
  for (const earlier of [...earlierQuestions].reverse()) {
    const verdict = verdictOf(earlier);
    if (verdict === 'english' || verdict === 'member') return verdict;
  }
  return 'english';
}

/** The last line of the model's instructions: which language to answer in. */
export function languageInstruction(language: ReplyLanguage): string {
  if (language === 'english') {
    return 'Reply language: English. The member is writing in English, so reply in English only, whatever language earlier replies in this conversation were in.';
  }
  if (language === 'member') {
    return "Reply language: the member's own. Their message is not in English: reply in the language their message is written in.";
  }
  return "Reply language: the language the member's message is written in; English if you cannot tell.";
}
