import type { IntentClassifier } from '../knowledge/types.js';

export function classifyIntent(question: string): IntentClassifier {
  const text = question.toLowerCase();

  if (/menu|open menu|close menu|factory reset|save settings|options|l2|l3/i.test(text)) return 'MENU';
  if (
    /what does vertical|what does horizontal|my gun climbs|gun keeps climbing|keeps climbing|pulls down|pulling downward|drifts|gun moves left|gun moves right|recoil|anti recoil|gun climbs/i.test(text)
  ) return 'RECOIL';
  if (/ads|precision|response|easing|ads sens/i.test(text)) return 'ADS_ACCURACY';
  if (/auto aim|r3|automatic aim/i.test(text)) return 'AUTO_AIM';
  if (/auto run|sprint|run/i.test(text)) return 'AUTO_RUN';
  if (/lean|follow lean/i.test(text)) return 'FOLLOW_LEAN';
  if (/setup|install|how do i|download|faq/i.test(text)) return 'SETUP';
  if (/ticket|support|issue|bug/i.test(text)) return 'TICKET_SUPPORT';
  if (/stable core|what is stable core|release|version/i.test(text)) return 'RELEASE_INFO';
  if (/where.*faq|where.*support|where.*download|where.*report bugs|announcement|channel/i.test(text)) return 'SERVER_NAVIGATION';
  if (/bug report|bug|error|reproduc/i.test(text)) return 'BUG_REPORT';
  if (/tune|vertical.*36|still climbing|pulling downward/i.test(text)) return 'TUNING';

  return 'GENERAL_QA';
}
