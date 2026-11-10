import { describe, expect, it } from 'vitest';

// These modules read the bot's environment when they load, so give them the values they need first.
process.env.DISCORD_TOKEN ??= 'test-token';
process.env.DISCORD_CLIENT_ID ??= 'test-client';
process.env.DISCORD_GUILD_ID ??= 'test-guild';

const { describeHours, isOpenAt, nextChange, parseClock, parseDays, roughDuration, validTimeZone } = await import('../src/tickets/supportHoursRules.js');
const { AUTO_CLOSE_GRACE_MS, AUTO_CLOSE_WAIT_MS, CLOSING_SOON_TITLE, KEPT_OPEN_TITLE, autoCloseAction, parseRating } = await import('../src/tickets/ticketRules.js');
const { PROBLEMS, advance, planFor } = await import('../src/tuning/tuningWizardRules.js');
const { looksNonEnglish } = await import('../src/ai/language.js');
const { supportStats } = await import('../src/tickets/ticketFeedback.js');
const { subscriptionStats } = await import('../src/owner/stats.js');
const { liveSubscriptionsByMember, tooManyToRemove, veteranTier } = await import('../src/premium/eliteAudit.js');
const { questionFromReport, taughtChunks, TAUGHT_SECTION } = await import('../src/knowledge/taughtAnswers.js');
const { isScriptAttachment } = await import('../src/premium/leakWatch.js');
const { KeywordRetriever } = await import('../src/knowledge/retriever.js');

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

describe('support hours', () => {
  it('reads times and days the way the owner types them', () => {
    expect(parseClock('10:00')).toBe(600);
    expect(parseClock('9:30pm')).toBe(21 * 60 + 30);
    expect(parseClock('12am')).toBe(0);
    expect(parseClock('22')).toBe(22 * 60);
    expect(parseClock('25:00')).toBeNull();
    expect(parseClock('noon')).toBeNull();
    expect(parseDays('every day')).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(parseDays('mon-fri')).toEqual([1, 2, 3, 4, 5]);
    expect(parseDays('fri-mon')).toEqual([0, 1, 5, 6]);
    expect(parseDays('mon,wed,fri')).toEqual([1, 3, 5]);
    expect(parseDays('weekends')).toEqual([0, 6]);
    expect(parseDays('someday')).toBeNull();
    expect(validTimeZone('America/New_York')).toBe(true);
    expect(validTimeZone('Mars/Base')).toBe(false);
  });

  it('knows when support is open, in the owner\'s time zone', () => {
    const hours = { days: [1, 2, 3, 4, 5], from: 600, to: 1320, timeZone: 'UTC' };
    // Monday 2 November 2026, 12:00 UTC, and 23:00 UTC.
    const mondayNoon = Date.UTC(2026, 10, 2, 12);
    expect(isOpenAt(hours, mondayNoon)).toBe(true);
    expect(isOpenAt(hours, Date.UTC(2026, 10, 2, 23))).toBe(false);
    expect(isOpenAt(hours, Date.UTC(2026, 10, 1, 12))).toBe(false); // Sunday
    expect(nextChange(hours, mondayNoon)).toBe(Date.UTC(2026, 10, 2, 22));
    // Saturday: next open is Monday 10:00.
    expect(nextChange(hours, Date.UTC(2026, 10, 7, 12))).toBe(Date.UTC(2026, 10, 9, 10));
    // New York is UTC-5 in November: 10:00 there is 15:00 UTC.
    const ny = { ...hours, timeZone: 'America/New_York' };
    expect(isOpenAt(ny, Date.UTC(2026, 10, 2, 14, 55))).toBe(false);
    expect(isOpenAt(ny, Date.UTC(2026, 10, 2, 15, 5))).toBe(true);
    expect(describeHours(hours)).toBe('Mon-Fri, 10:00-22:00 (UTC)');
  });

  it('handles a window past midnight', () => {
    const late = { days: [5], from: 20 * 60, to: 2 * 60, timeZone: 'UTC' }; // Friday 20:00 to Saturday 02:00
    expect(isOpenAt(late, Date.UTC(2026, 10, 6, 21))).toBe(true); // Friday 21:00
    expect(isOpenAt(late, Date.UTC(2026, 10, 7, 1))).toBe(true); // Saturday 01:00
    expect(isOpenAt(late, Date.UTC(2026, 10, 7, 3))).toBe(false);
    expect(isOpenAt(late, Date.UTC(2026, 10, 5, 1))).toBe(false); // Thursday 01:00
  });

  it('says reply times roughly', () => {
    expect(roughDuration(25 * 60 * 1000)).toBe('about 25 minutes');
    expect(roughDuration(3 * HOUR)).toBe('about 3 hours');
    expect(roughDuration(3 * DAY)).toBe('about 3 days');
  });
});

describe('ticket auto-close', () => {
  const member = 'm';
  const base = { memberId: member, createdAt: 0 };
  const said = (authorId: string, at: number, bot = false, title: string | null = null) => ({ authorId, at, bot, title });

  it('never closes a ticket waiting on the team', () => {
    // The member wrote last; nobody on the team answered. Days pass.
    expect(autoCloseAction({ ...base, messages: [said('bot', 1, true, 'Ticket #0001'), said(member, 10)], now: 10 * DAY })).toBe('none');
    // Only the bot's own notices: still waiting on the team.
    expect(autoCloseAction({ ...base, messages: [said('bot', 1, true, 'Ticket #0001'), said('bot', 2, true, 'Team called')], now: 10 * DAY })).toBe('none');
  });

  it('warns after 48 hours without the member answering the team, then closes 24 hours later', () => {
    const answered = [said(member, 10), said('staff', 1000)];
    expect(autoCloseAction({ ...base, messages: answered, now: 1000 + AUTO_CLOSE_WAIT_MS - 1 })).toBe('none');
    expect(autoCloseAction({ ...base, messages: answered, now: 1000 + AUTO_CLOSE_WAIT_MS })).toBe('warn');
    const warned = [...answered, said('bot', 1000 + AUTO_CLOSE_WAIT_MS, true, CLOSING_SOON_TITLE)];
    expect(autoCloseAction({ ...base, messages: warned, now: 1000 + AUTO_CLOSE_WAIT_MS + 5 * HOUR })).toBe('none');
    expect(autoCloseAction({ ...base, messages: warned, now: 1000 + AUTO_CLOSE_WAIT_MS + AUTO_CLOSE_GRACE_MS })).toBe('close');
  });

  it('counts the assistant\'s first look as the team, and a reply or "I still need help" as the member', () => {
    expect(autoCloseAction({ ...base, messages: [said('bot', 5, true, 'First look')], now: 5 + AUTO_CLOSE_WAIT_MS })).toBe('warn');
    const warnedAt = 5 + AUTO_CLOSE_WAIT_MS;
    const kept = [said('bot', 5, true, 'First look'), said('bot', warnedAt, true, CLOSING_SOON_TITLE), said('bot', warnedAt + HOUR, true, KEPT_OPEN_TITLE)];
    expect(autoCloseAction({ ...base, messages: kept, now: warnedAt + 3 * DAY })).toBe('none');
    const replied = [said('bot', 5, true, 'First look'), said('bot', warnedAt, true, CLOSING_SOON_TITLE), said(member, warnedAt + HOUR)];
    expect(autoCloseAction({ ...base, messages: replied, now: warnedAt + 3 * DAY })).toBe('none');
  });

  it('reads the rating buttons', () => {
    expect(parseRating('tcp-ticket:rate:42:5')).toEqual({ number: 42, stars: 5 });
    expect(parseRating('tcp-ticket:rate:42:6')).toBeNull();
    expect(parseRating('tcp-ticket:close')).toBeNull();
  });
});

describe('support summary', () => {
  const ticket = (overrides: Record<string, unknown>) => ({
    number: 1,
    discordUserId: 'u',
    channelId: 'c',
    kind: 'setup',
    status: 'closed' as const,
    claimedBy: null,
    createdAt: 10 * DAY,
    closedAt: 11 * DAY,
    closedBy: 's1',
    rating: null,
    firstResponseAt: null,
    ...overrides,
  });

  it('counts tickets, the median first reply, ratings and who answered', () => {
    const records = [
      ticket({ number: 1, claimedBy: 's1', rating: 5, firstResponseAt: 10 * DAY + HOUR }),
      ticket({ number: 2, claimedBy: 's1', rating: 3, firstResponseAt: 10 * DAY + 3 * HOUR }),
      ticket({ number: 3, claimedBy: 's2', rating: 4, firstResponseAt: 10 * DAY + 2 * HOUR, closedBy: 'auto' }),
      ticket({ number: 4, status: 'open', closedAt: null, closedBy: null }),
      ticket({ number: 5, createdAt: 2 * DAY, closedAt: 9 * DAY }), // closed before the window
    ];
    const stats = supportStats(records as never, 7 * DAY + 12 * HOUR);
    expect(stats.opened).toBe(4);
    expect(stats.closed).toBe(4);
    expect(stats.autoClosed).toBe(1);
    expect(stats.stillOpen).toBe(1);
    expect(stats.medianFirstResponseMs).toBe(2 * HOUR);
    expect(stats.averageRating).toBe(4);
    expect(stats.byStaff).toEqual([
      { id: 's1', tickets: 2, averageRating: 4 },
      { id: 's2', tickets: 1, averageRating: 4 },
    ]);
  });
});

describe('owner stats', () => {
  const sub = (overrides: Record<string, unknown>) => ({
    id: 's',
    discordUserId: 'u',
    status: 'active',
    priceId: 'p',
    interval: 'month',
    intervalCount: 1,
    unitAmount: 1500,
    currency: 'usd',
    startedAt: 0,
    createdAt: 0,
    endedAt: null,
    cancelAtPeriodEnd: false,
    ...overrides,
  });

  it('counts plans and works out monthly revenue', () => {
    const now = 100 * DAY;
    const stats = subscriptionStats(
      [
        sub({}),
        sub({ cancelAtPeriodEnd: true }),
        sub({ interval: 'year', unitAmount: 15000, createdAt: now - DAY }),
        sub({ status: 'past_due' }),
        sub({ status: 'canceled', endedAt: now - 2 * DAY }),
      ] as never,
      now,
    );
    expect(stats.live).toBe(4);
    expect(stats.monthly).toBe(3);
    expect(stats.yearly).toBe(1);
    expect(stats.cancelling).toBe(1);
    expect(stats.pastDue).toBe(1);
    expect(stats.newThisWeek).toBe(1);
    expect(stats.endedThisWeek).toBe(1);
    expect(stats.mrr.get('usd')).toBe(1500 * 3 + 15000 / 12);
  });
});

describe('daily Elite check', () => {
  it('gives Veteran tiers at 3, 6 and 12 months without a break', () => {
    expect(veteranTier(0, 80 * DAY)).toBe(0);
    expect(veteranTier(0, 92 * DAY)).toBe(3);
    expect(veteranTier(0, 190 * DAY)).toBe(6);
    expect(veteranTier(0, 370 * DAY)).toBe(12);
  });

  it('holds back a removal that touches too many members at once', () => {
    expect(tooManyToRemove(5, 10)).toBe(false);
    expect(tooManyToRemove(6, 10)).toBe(true);
    expect(tooManyToRemove(30, 100)).toBe(false);
    expect(tooManyToRemove(31, 100)).toBe(true);
  });

  it('keeps each member\'s longest-running live subscription', () => {
    const live = liveSubscriptionsByMember([
      { discordUserId: 'a', status: 'active', startedAt: 50 },
      { discordUserId: 'a', status: 'active', startedAt: 10 },
      { discordUserId: 'b', status: 'canceled', startedAt: 10 },
      { discordUserId: null, status: 'active', startedAt: 10 },
    ] as never);
    expect([...live.keys()]).toEqual(['a']);
    expect(live.get('a')!.startedAt).toBe(10);
  });
});

describe('tuning wizard', () => {
  it('offers a plan for every problem, on every setup', () => {
    for (const problem of PROBLEMS)
      for (const setup of [
        { premium: true, pull: false },
        { premium: true, pull: true },
        { premium: false, pull: false },
      ])
        expect(planFor(problem.key, setup).length).toBeGreaterThan(0);
  });

  it('tunes a recorded pull with Scale Y, and never names a locked or missing setting', () => {
    const pull = planFor('climbs', { premium: true, pull: true }).map((step) => step.text).join(' ');
    expect(pull).toContain('Scale Y');
    expect(pull).not.toContain('Vertical Recoil');
    const free = PROBLEMS.flatMap((problem) => planFor(problem.key, { premium: false, pull: false })).map((step) => step.text).join(' ');
    expect(free).not.toMatch(/Scale Y|Micro Precision|Recovery Speed|Turn Release|WORKSHOP/);
    const premium = PROBLEMS.flatMap((problem) => planFor(problem.key, { premium: true, pull: false })).map((step) => step.text).join(' ');
    expect(premium).not.toMatch(/Easing|Steady Hold|\*\*Precision\*\*/);
  });

  it('drifting left raises Horizontal, drifting right lowers it (the documented direction)', () => {
    expect(planFor('left', { premium: true, pull: false })[0]!.text).toMatch(/^Raise \*\*Horizontal Recoil\*\*/);
    expect(planFor('right', { premium: true, pull: false })[0]!.text).toMatch(/^Lower \*\*Horizontal Recoil\*\*/);
  });

  it('repeats a step while it helps, moves on when it does not, and ends', () => {
    const plan = [{ text: 'a', repeat: 1 }, { text: 'b' }];
    expect(advance(plan, { step: 0, times: 0 }, 'better')).toMatchObject({ next: 'step', progress: { step: 0, times: 1 }, again: true });
    expect(advance(plan, { step: 0, times: 1 }, 'better')).toMatchObject({ next: 'step', progress: { step: 1, times: 0 } });
    expect(advance(plan, { step: 0, times: 0 }, 'worse')).toMatchObject({ next: 'step', progress: { step: 1, times: 0 }, undo: true });
    expect(advance(plan, { step: 1, times: 0 }, 'same')).toMatchObject({ next: 'end' });
    expect(advance(plan, { step: 0, times: 0 }, 'fixed')).toMatchObject({ next: 'done' });
  });
});

describe('member language', () => {
  it('spots questions that are not in English', () => {
    expect(looksNonEnglish('el script no funciona cuando apunto')).toBe(true);
    expect(looksNonEnglish('meu recoil não está funcionando')).toBe(true);
    expect(looksNonEnglish('wie stelle ich die vertikale ein, das funktioniert nicht')).toBe(true);
    expect(looksNonEnglish('скрипт не работает')).toBe(true);
    expect(looksNonEnglish('my gun climbs when I spray, what should vertical be')).toBe(false);
    expect(looksNonEnglish('drop roll not working')).toBe(false);
    expect(looksNonEnglish('m4 v28')).toBe(false);
  });
});

describe('teach the bot', () => {
  it('takes the question from a report and makes it searchable', async () => {
    expect(questionFromReport('> how do I\n> set it')).toBe('how do I\nset it');
    const chunks = taughtChunks([{ id: 3, question: 'Does T.C.P work with a Hori controller?', answer: 'Yes, through the Zen like any PS controller.', by: 'o', at: 0 }]);
    expect(chunks[0]!.section).toBe(TAUGHT_SECTION);
    const results = await new KeywordRetriever(chunks).search('does it work with hori controller', 1);
    expect(results[0]?.chunk.id).toBe('taught-3');
  });
});

describe('leak watch', () => {
  it('checks script and text files only, and not huge ones', () => {
    expect(isScriptAttachment('T.C.P Premium.gpc', 120_000)).toBe(true);
    expect(isScriptAttachment('script.TXT', 120_000)).toBe(true);
    expect(isScriptAttachment('clip.mp4', 120_000)).toBe(false);
    expect(isScriptAttachment('big.gpc', 5_000_000)).toBe(false);
  });
});
