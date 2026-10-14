import { describe, expect, it } from 'vitest';

// These modules read the bot's environment when they load, so give them the required values first.
process.env.DISCORD_TOKEN ??= 'test-token';
process.env.DISCORD_CLIENT_ID ??= 'test-client';
process.env.DISCORD_GUILD_ID ??= 'test-guild';
const {
  summarizeRatings,
  starString,
  roundedStars,
  ratingChannelName,
  readReviewForm,
  cooldownMinutesLeft,
  buildReviewPanel,
  buildReviewCard,
  REVIEW_COOLDOWN_MS,
} = await import('../src/reviews/reviews.js');

const now = 1_700_000_000_000;

describe('rating summary', () => {
  it('averages the stars and counts each star level', () => {
    const summary = summarizeRatings([5, 5, 4, 3, 5]);
    expect(summary.count).toBe(5);
    expect(summary.average).toBeCloseTo(4.4);
    expect(summary.byStars).toEqual([0, 0, 1, 1, 3]);
  });

  it('ignores anything that is not 1 to 5 whole stars', () => {
    expect(summarizeRatings([0, 6, 2.5, 4]).count).toBe(1);
  });

  it('is empty with no reviews', () => {
    expect(summarizeRatings([])).toEqual({ count: 0, average: 0, byStars: [0, 0, 0, 0, 0] });
  });
});

describe('stars', () => {
  it('draws one star per point', () => {
    expect(starString(3)).toBe('⭐⭐⭐');
    expect(starString(9)).toBe('⭐⭐⭐⭐⭐');
  });

  it('rounds the average to whole stars, at least one', () => {
    expect(roundedStars(4.4)).toBe(4);
    expect(roundedStars(4.5)).toBe(5);
    expect(roundedStars(0.2)).toBe(1);
  });
});

describe('rating channel name', () => {
  it('shows stars, the average and the count', () => {
    expect(ratingChannelName(summarizeRatings([5, 5, 4]))).toBe('⭐⭐⭐⭐⭐ 4.7 (3 reviews)');
    expect(ratingChannelName(summarizeRatings([4]))).toBe('⭐⭐⭐⭐ 4.0 (1 review)');
  });

  it('says when there are no reviews yet', () => {
    expect(ratingChannelName(summarizeRatings([]))).toBe('⭐ No reviews yet');
  });

  it('fits in a Discord channel name', () => {
    expect(ratingChannelName({ count: 99999, average: 4.95, byStars: [0, 0, 0, 0, 99999] }).length).toBeLessThanOrEqual(100);
  });
});

describe('review form', () => {
  it('accepts a review and trims it', () => {
    expect(readReviewForm({ stars: 5, headline: '  Great  ', text: '  Recoil is gone.  ' })).toEqual({
      stars: 5,
      headline: 'Great',
      text: 'Recoil is gone.',
    });
  });

  it('needs a few words', () => {
    expect(readReviewForm({ stars: 4, headline: '', text: 'good' })).toHaveProperty('error');
  });

  it('needs 1 to 5 whole stars', () => {
    expect(readReviewForm({ stars: 0, headline: '', text: 'Works well for me' })).toHaveProperty('error');
    expect(readReviewForm({ stars: 6, headline: '', text: 'Works well for me' })).toHaveProperty('error');
  });

  it('lets a member review again once the cooldown has passed', () => {
    expect(cooldownMinutesLeft(undefined, now)).toBe(0);
    expect(cooldownMinutesLeft(now - 60_000, now)).toBe(9);
    expect(cooldownMinutesLeft(now - REVIEW_COOLDOWN_MS, now)).toBe(0);
  });
});

describe('review panel and card', () => {
  it('shows the average and a bar per star level', () => {
    const panel = buildReviewPanel(summarizeRatings([5, 5, 4]));
    const text = panel.embeds[0].toJSON().description ?? '';
    expect(text).toContain('**4.7** out of 5 from **3** reviews');
    expect(text).toContain('`5` ⭐ ██████████ 2');
    expect(text).toContain('`4` ⭐ █████ 1');
    expect(JSON.stringify(panel.components)).toContain('tcp-review:start');
  });

  it('invites the first review when there are none', () => {
    expect(buildReviewPanel(summarizeRatings([])).embeds[0].toJSON().description).toContain('No reviews yet');
  });

  it('puts the stars and headline in the card title', () => {
    const card = buildReviewCard({ stars: 4, headline: 'Solid', text: 'Recoil control is great.' }, '123', { name: 'Tester' }).toJSON();
    expect(card.title).toBe('⭐⭐⭐⭐  Solid');
    expect(card.description).toBe('Recoil control is great.');
    expect(card.fields?.find((field) => field.name === 'Reviewed by')?.value).toBe('<@123>');
  });
});
