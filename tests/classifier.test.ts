import { describe, expect, it } from 'vitest';
import { classifyIntent } from '../src/ai/classifier.js';

describe('classifier', () => {
  it('detects recoil questions', () => {
    expect(classifyIntent('my gun keeps climbing')).toBe('RECOIL');
  });

  it('detects menu questions', () => {
    expect(classifyIntent('how do I open the menu')).toBe('MENU');
  });
});
