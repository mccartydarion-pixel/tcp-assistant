import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SCRIPTS, applyChange, bannerFile, cardDescription, cardFields, cardSignature, cardTitle, effectiveStatus, scriptOf } from '../src/scripts/scriptStatusRules.js';

const dayz = scriptOf('dayz')!;
const bf6 = scriptOf('bf6')!;
const NOW = 1_800_000_000_000;

describe('script status cards', () => {
  it('has a banner for every script and state', () => {
    for (const script of SCRIPTS)
      for (const state of ['online', 'updating', 'down'] as const) expect(existsSync(resolve('assets', 'status', bannerFile(script, state)))).toBe(true);
  });

  it('fills DayZ from what the script has and leaves unknown fields off the other cards', () => {
    const status = effectiveStatus(dayz, undefined);
    expect(cardTitle(dayz, status)).toBe('🟢 DayZ · T.C.P Premium is ONLINE');
    expect(cardFields(status).map((field) => field.name)).toEqual(['Status', 'Build', 'Updated', 'Device', 'Platforms', 'Editions', "What's in it", 'Latest changes']);
    const other = effectiveStatus(bf6, undefined);
    expect(cardFields(other).map((field) => field.name)).toEqual(['Status', 'Device']);
    expect(cardTitle(bf6, other)).toBe('🟢 Battlefield 6 · T.C.P is ONLINE');
  });

  it('stamps a new state and a new build, and "-" clears a field', () => {
    const current = effectiveStatus(dayz, {});
    const next = applyChange({}, current, { state: 'updating', note: 'New patch, fix coming', build: '2026.11.12', platforms: '-' }, NOW);
    expect(next).toMatchObject({ state: 'updating', changedAt: NOW, build: '2026.11.12', updatedAt: NOW, note: 'New patch, fix coming', platforms: '' });
    const after = effectiveStatus(dayz, next);
    expect(cardTitle(dayz, after)).toBe('🟡 DayZ · T.C.P Premium is UPDATING');
    expect(cardDescription(dayz, after)).toContain('New patch, fix coming');
    expect(cardFields(after).map((field) => field.name)).not.toContain('Platforms');
    // The same state again is not a change.
    expect(applyChange(next, after, { state: 'updating' }, NOW + 1000).changedAt).toBe(NOW);
  });

  it('only accepts a web address as a download link, and changes the signature when the card changes', () => {
    expect(effectiveStatus(bf6, { download: 'not a link' }).download).toBe('');
    expect(effectiveStatus(bf6, { download: 'https://example.com/bf6' }).download).toBe('https://example.com/bf6');
    const a = cardSignature(bf6, effectiveStatus(bf6, {}));
    expect(cardSignature(bf6, effectiveStatus(bf6, {}))).toBe(a);
    expect(cardSignature(bf6, effectiveStatus(bf6, { state: 'down' }))).not.toBe(a);
  });

  it('says what a paused script means', () => {
    expect(cardDescription(bf6, effectiveStatus(bf6, { state: 'down' }))).toMatch(/hold off/);
  });
});
