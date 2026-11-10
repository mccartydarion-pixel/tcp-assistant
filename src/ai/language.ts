// Members write in many languages. The documentation is English and the search is by English keywords, so a
// question that is not in English is translated for the search only; the assistant still reads the
// member's own words and answers in their language (the system prompt says so).

const ENGLISH = new Set(
  'the a an is are was be to of and or in on at it my me i you your we our how what why when where which do does did not no can cant cannot will with for from this that there have has get got after before still just like feel feels'.split(' '),
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
