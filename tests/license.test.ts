import { describe, expect, it } from 'vitest';
import {
  CODE_MAX,
  CODE_MIN,
  TIER_USES,
  computeLicenseCode,
  daysLeft,
  decideLicense,
  extendExpiry,
  parseChallenge,
  parseDays,
  parseLicenseKey,
  shouldGrantTrial,
  tierForDaysLeft,
  type LicenseKey,
  type LicenseTier,
} from '../src/license/licenseCode.js';

// A made-up key for tests only. The real key lives in the LICENSE_SECRET environment variable.
const testKey: LicenseKey = [12345, 6789, 20999, 99999, 1000, 0];
const tiers: LicenseTier[] = [1, 2, 3, 4, 5];
const DAY = 24 * 60 * 60 * 1000;

describe('licence code', () => {
  // Expected values come from a separate implementation of the same arithmetic, so a change to the
  // formula here fails until the script is changed to match.
  it('matches the reference values', () => {
    expect(computeLicenseCode(10000, testKey, 1)).toBe(266836);
    expect(computeLicenseCode(48213, testKey, 3)).toBe(471019);
    expect(computeLicenseCode(99999, testKey, 5)).toBe(642653);
  });

  it('always gives a six-digit code and never exceeds 32-bit arithmetic', () => {
    const largestKey: LicenseKey = [20999, 99999, 20999, 99999, 20999, 99999];
    for (let challenge = 10000; challenge <= 99999; challenge += 7) {
      for (const tier of tiers) {
        const code = computeLicenseCode(challenge, largestKey, tier);
        expect(code).toBeGreaterThanOrEqual(CODE_MIN);
        expect(code).toBeLessThanOrEqual(CODE_MAX);
      }
    }
    // The largest products in the formula with the largest key and tier.
    expect(99999 * 20999 + 99999 + 5 * 7919).toBeLessThan(2 ** 31);
    expect(99990 * 20999 + 99999).toBeLessThan(2 ** 31);
  });

  it('spreads the codes widely instead of collapsing onto a few', () => {
    const codes = new Set<number>();
    for (let challenge = 10000; challenge <= 99999; challenge += 1) codes.add(computeLicenseCode(challenge, testKey, 3));
    expect(codes.size).toBeGreaterThan(50000);
  });

  it('gives every tier its own code for the same number', () => {
    for (const challenge of [10000, 48213, 73520, 99999]) {
      expect(new Set(tiers.map((tier) => computeLicenseCode(challenge, testKey, tier))).size).toBe(5);
    }
  });

  it('rejects a number outside five digits', () => {
    expect(() => computeLicenseCode(9999, testKey, 1)).toThrow(RangeError);
    expect(() => computeLicenseCode(100000, testKey, 1)).toThrow(RangeError);
  });
});

describe('licence input', () => {
  it('reads a five-digit number, ignoring spaces', () => {
    expect(parseChallenge('48213')).toBe(48213);
    expect(parseChallenge(' 48 213 ')).toBe(48213);
  });

  it('rejects anything else', () => {
    expect(parseChallenge('4821')).toBeNull();
    expect(parseChallenge('482130')).toBeNull();
    expect(parseChallenge('4821a')).toBeNull();
    expect(parseChallenge('01234')).toBeNull();
    expect(parseChallenge('')).toBeNull();
  });

  it('reads a well-formed key and rejects a malformed one', () => {
    expect(parseLicenseKey('12345, 6789, 20999, 99999, 1000, 0')).toEqual(testKey);
    expect(parseLicenseKey(undefined)).toBeNull();
    expect(parseLicenseKey('1,2,3')).toBeNull();
    expect(parseLicenseKey('12345,6789,20999,99999,1000,x')).toBeNull();
    expect(parseLicenseKey('999,0,1000,0,1000,0')).toBeNull();
    expect(parseLicenseKey('21000,0,1000,0,1000,0')).toBeNull();
    expect(parseLicenseKey('1000,100000,1000,0,1000,0')).toBeNull();
  });

  it('reads a number of days between 1 and 3650', () => {
    expect(parseDays('30')).toBe(30);
    expect(parseDays(' 3650 ')).toBe(3650);
    expect(parseDays('0')).toBeNull();
    expect(parseDays('3651')).toBeNull();
    expect(parseDays('-5')).toBeNull();
    expect(parseDays('ten')).toBeNull();
  });
});

describe('subscription', () => {
  const now = 1_700_000_000_000;

  it('counts days left, rounding a part day up', () => {
    expect(daysLeft(null, now)).toBe(0);
    expect(daysLeft(now + 30 * DAY, now)).toBe(30);
    expect(daysLeft(now + 1, now)).toBe(1);
    expect(daysLeft(now, now)).toBe(0);
    expect(daysLeft(now - DAY, now)).toBe(-1);
  });

  it('picks the tier from the days left', () => {
    expect(tierForDaysLeft(0)).toBeNull();
    expect(tierForDaysLeft(-3)).toBeNull();
    expect(tierForDaysLeft(1)).toBe(1);
    expect(tierForDaysLeft(7)).toBe(1);
    expect(tierForDaysLeft(8)).toBe(2);
    expect(tierForDaysLeft(15)).toBe(2);
    expect(tierForDaysLeft(16)).toBe(3);
    expect(tierForDaysLeft(33)).toBe(3);
    expect(tierForDaysLeft(34)).toBe(4);
    expect(tierForDaysLeft(62)).toBe(4);
    expect(tierForDaysLeft(63)).toBe(5);
    expect(tierForDaysLeft(400)).toBe(5);
  });

  it('lasts longer the more days are left', () => {
    expect(TIER_USES).toEqual({ 1: 20, 2: 50, 3: 80, 4: 200, 5: 400 });
  });

  it('adds days on top of time left, or from now when lapsed or new', () => {
    expect(extendExpiry(null, 30, now)).toBe(now + 30 * DAY);
    expect(extendExpiry(now + 10 * DAY, 30, now)).toBe(now + 40 * DAY);
    expect(extendExpiry(now - 10 * DAY, 30, now)).toBe(now + 30 * DAY);
  });
});

describe('free trial', () => {
  it('grants to a new member with no subscription', () => {
    expect(shouldGrantTrial({ daysLeft: 0, hadTrial: false, isOwner: false })).toBe(true);
    expect(shouldGrantTrial({ daysLeft: -5, hadTrial: false, isOwner: false })).toBe(true);
  });

  it('does not grant a second time once used', () => {
    expect(shouldGrantTrial({ daysLeft: 0, hadTrial: true, isOwner: false })).toBe(false);
  });

  it('does not grant while a subscription is still active', () => {
    expect(shouldGrantTrial({ daysLeft: 10, hadTrial: false, isOwner: false })).toBe(false);
  });

  it('never grants to the owner', () => {
    expect(shouldGrantTrial({ daysLeft: 0, hadTrial: false, isOwner: true })).toBe(false);
  });
});

describe('licence limit', () => {
  it('issues until the daily limit, then refuses', () => {
    expect(decideLicense({ alreadyIssued: false, issuedToday: 2, maxPerDay: 3, isOwner: false })).toBe('ISSUE');
    expect(decideLicense({ alreadyIssued: false, issuedToday: 3, maxPerDay: 3, isOwner: false })).toBe('LIMIT');
  });

  it('re-sends a code for a number already used, even at the limit', () => {
    expect(decideLicense({ alreadyIssued: true, issuedToday: 3, maxPerDay: 3, isOwner: false })).toBe('REISSUE');
  });

  it('never limits the owner', () => {
    expect(decideLicense({ alreadyIssued: false, issuedToday: 50, maxPerDay: 3, isOwner: true })).toBe('ISSUE');
  });
});
