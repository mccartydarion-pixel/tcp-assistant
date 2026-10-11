// Licence codes for the T.C.P. script.
//
// The script shows a five-digit number on the Zen's screen. This module turns that number into the
// six-digit code that unlocks it. The script carries the same arithmetic and the same key, so the two
// must stay in step: change one and the other has to change with it.
//
// A code also belongs to a tier, chosen from the days left on the member's subscription. The tier
// decides how many power-ups the code lasts on the Zen, so a subscription near its end has to come
// back here sooner.
//
// Every intermediate value stays below 2^31 and is never negative, because the script runs on 32-bit
// signed integers.

export const CHALLENGE_MIN = 10000;
export const CHALLENGE_MAX = 99999;
export const CODE_MIN = 100000;
export const CODE_MAX = 999999;

const MULTIPLIER_MIN = 1000;
const MULTIPLIER_MAX = 20999;
const OFFSET_MAX = 99999;
const TIER_STEP = 7919;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Three multiplier/offset pairs: [a1, b1, a2, b2, a3, b3]. */
export type LicenseKey = readonly [number, number, number, number, number, number];

export type LicenseTier = 1 | 2 | 3 | 4 | 5;

/** Power-ups a code of each tier lasts. Mirrors license_uses() in the script. */
export const TIER_USES: Record<LicenseTier, number> = { 1: 20, 2: 50, 3: 80, 4: 200, 5: 400 };

/** Reads a key written as six comma-separated whole numbers. Returns null if it is missing or malformed. */
export function parseLicenseKey(secret: string | undefined): LicenseKey | null {
  if (!secret) return null;
  const parts = secret.split(',').map((part) => part.trim());
  if (parts.length !== 6 || parts.some((part) => !/^\d+$/.test(part))) return null;
  const values = parts.map(Number);
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]!;
    const isMultiplier = index % 2 === 0;
    if (isMultiplier && (value < MULTIPLIER_MIN || value > MULTIPLIER_MAX)) return null;
    if (!isMultiplier && value > OFFSET_MAX) return null;
  }
  return values as unknown as LicenseKey;
}

/** Reads the number a member typed. Spaces are ignored; anything but five digits is rejected. */
export function parseChallenge(input: string): number | null {
  const cleaned = input.replace(/\s+/g, '');
  if (!/^\d{5}$/.test(cleaned)) return null;
  const challenge = Number(cleaned);
  if (challenge < CHALLENGE_MIN || challenge > CHALLENGE_MAX) return null;
  return challenge;
}

export function computeLicenseCode(challenge: number, key: LicenseKey, tier: LicenseTier): number {
  if (!Number.isInteger(challenge) || challenge < CHALLENGE_MIN || challenge > CHALLENGE_MAX) {
    throw new RangeError('Challenge must be a five-digit number.');
  }
  const [a1, b1, a2, b2, a3, b3] = key;
  let value = (challenge * a1 + b1 + tier * TIER_STEP) % 99991;
  value = (value * a2 + b2) % 99989;
  value = (value + (value % 9973) * (value % 97)) % 99971;
  // The moduli are all prime, so no choice of key can collapse the codes onto a few values.
  value = (value * a3 + b3) % 899981;
  return CODE_MIN + value;
}

/** Whole days left on a subscription, rounded up; 0 or less means it has run out. */
export function daysLeft(expiresAt: number | null, now: number): number {
  if (expiresAt === null) return 0;
  return Math.ceil((expiresAt - now) / DAY_MS);
}

/** The tier for a number of days left, or null when the subscription has run out. */
export function tierForDaysLeft(days: number): LicenseTier | null {
  if (days >= 63) return 5;
  if (days >= 34) return 4;
  if (days >= 16) return 3;
  if (days >= 8) return 2;
  if (days >= 1) return 1;
  return null;
}

/** Adds days to a subscription. Time left is kept; a lapsed or new subscription starts from now. */
export function extendExpiry(currentExpiresAt: number | null, days: number, now: number): number {
  const from = currentExpiresAt !== null && currentExpiresAt > now ? currentExpiresAt : now;
  return from + days * DAY_MS;
}

/** Reads a whole number of days between 1 and 3650. */
export function parseDays(input: string): number | null {
  const cleaned = input.trim();
  if (!/^\d{1,4}$/.test(cleaned)) return null;
  const days = Number(cleaned);
  if (days < 1 || days > 3650) return null;
  return days;
}

export type LicenseDecision = 'REISSUE' | 'ISSUE' | 'LIMIT';

/**
 * Whether a member with an active subscription may have a code now. Asking again for a number they
 * already used never counts against them, and the owner has no limit.
 */
export function decideLicense(input: {
  alreadyIssued: boolean;
  issuedToday: number;
  maxPerDay: number;
  isOwner: boolean;
}): LicenseDecision {
  if (input.alreadyIssued) return 'REISSUE';
  if (input.isOwner || input.issuedToday < input.maxPerDay) return 'ISSUE';
  return 'LIMIT';
}
