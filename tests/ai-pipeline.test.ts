import { describe, expect, it } from 'vitest';
import { buildTCPPrompt } from '../src/ai/promptBuilder.js';
import { extractQuestionDetails, normalizeUserQuestion } from '../src/ai/question.js';
import { detectBotMention } from '../src/bot/mention.js';

const question = 'my gun keeps going UP and my vertical is 38, ADS Sens 90 Precision 45 Response 95 Easing 8 at 150m';

 describe('intelligent RAG pipeline', () => {
  it('removes only the bot mention during normalization', () => {
    expect(normalizeUserQuestion('<@123> my gun keeps going UP, vertical is 38', '123'))
      .toBe('my gun keeps going UP, vertical is 38');
    expect(normalizeUserQuestion('<@!123> can i speak to the owner please', '123'))
      .toBe('can i speak to the owner please');
  });

  it('detects only ID-based Discord mentions', () => {
    const noParsedMention = { users: { has: () => false } };
    expect(detectBotMention({ content: '<@123> hello', mentions: noParsedMention }, '123')).toBe(true);
    expect(detectBotMention({ content: '<@!123> hello', mentions: noParsedMention }, '123')).toBe(true);
    expect(detectBotMention({ content: 'T.C.P. Assistant hello', mentions: noParsedMention }, '123')).toBe(false);
  });

  it('extracts symptoms and preserves all numeric settings', () => {
    expect(extractQuestionDetails(question)).toMatchObject({
      topic: 'ads_accuracy',
      symptom: 'upward_climb',
      vertical: 38,
      adsSens: 90,
      precision: 45,
      response: 95,
      easing: 8,
      distance: 150,
    });
  });

  it('separates retrieved documentation from the actual question and limits history', () => {
    const prompt = buildTCPPrompt({
      question,
      details: extractQuestionDetails(question),
      retrievedChunks: [
        { chunk: { id: 'vertical', section: 'Vertical Recoil', heading: 'Vertical Recoil', content: 'Documented vertical guidance.', source: 'docs', keywords: [] }, score: 10 },
        { chunk: { id: 'ads', section: 'ADS Accuracy', heading: 'ADS Accuracy', content: 'Documented ADS guidance.', source: 'docs', keywords: [] }, score: 8 },
      ],
      conversationHistory: Array.from({ length: 10 }, (_, index) => ({ role: 'user' as const, content: `turn ${index}` })),
    });

    expect(prompt.context).toContain('[Vertical Recoil]');
    expect(prompt.context).toContain('[ADS Accuracy]');
    expect(prompt.context).toContain('vertical":38');
    expect(prompt.history).toHaveLength(8);
    expect(prompt.question).toBe(question);
    expect(prompt.system).toContain("user's actual problem");
  });
});
