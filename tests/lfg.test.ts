import { describe, expect, it } from 'vitest';

// These modules read the bot's environment when they load, so give them the values they need first.
process.env.DISCORD_TOKEN ??= 'test-token';
process.env.DISCORD_CLIENT_ID ??= 'test-client';
process.env.DISCORD_GUILD_ID ??= 'test-guild';

const rules = await import('../src/lfg/lfgRules.js');
const { applyRatings, lfgPlayerOf, pruneSquads } = await import('../src/lfg/lfgStore.js');
const { cardEditorView, panelView, ratingView, readyCheckView, squadIntroView } = await import('../src/lfg/lfgViews.js');

const { COMMUNITIES, ELITE_HEAD_START_MS, LOW_TRUST_REPORTS, RATING_WINDOW_MS, bestJoiner, compatible, formSquads, groupScore, isLowTrust, pairScore, readCard, readRep, scoreThreshold } =
  rules;
type Seeker = import('../src/lfg/lfgRules.js').Seeker;
type LfgCard = import('../src/lfg/lfgRules.js').LfgCard;

const dayz = COMMUNITIES[0]!;
const MINUTE = 60 * 1000;
const NOW = 1_800_000_000_000;

const card = (overrides: Partial<LfgCard> = {}): LfgCard => ({
  platform: 'ps',
  region: 'nae',
  language: 'en',
  playstyles: ['pvp', 'mil'],
  mic: 'yes',
  experience: 'experienced',
  server: 'official',
  gamertag: 'Survivor',
  bio: '',
  updatedAt: 0,
  ...overrides,
});

let next = 0;
const seeker = (overrides: Partial<Seeker> = {}, cardOverrides: Partial<LfgCard> = {}): Seeker => ({
  userId: String(100000 + (next += 1)),
  community: 'dayz',
  card: card(cardOverrides),
  mode: 'pvp',
  size: 2,
  since: NOW,
  lowTrust: false,
  elite: false,
  avoid: [],
  mates: [],
  ...overrides,
});

describe('squad finder cards', () => {
  it('accepts a complete card and refuses one with anything missing or unknown', () => {
    expect(readCard(card(), dayz)).toMatchObject({ platform: 'ps', playstyles: ['pvp', 'mil'] });
    expect(readCard({ ...card(), gamertag: '  ' }, dayz)).toBeNull();
    expect(readCard({ ...card(), platform: 'pc' as never }, dayz)).toBeNull();
    expect(readCard({ ...card(), playstyles: ['nope'] }, dayz)).toBeNull();
    expect(readCard({ ...card(), playstyles: ['pvp', 'pve', 'base', 'raid'] }, dayz)?.playstyles).toHaveLength(3);
    expect(readCard({ ...card(), server: 'daynite' }, dayz)?.server).toBe('daynite');
  });
});

describe('squad finder matching', () => {
  it('never mixes platforms, languages, trust tiers or members who reported each other', () => {
    const a = seeker();
    expect(compatible(a, seeker({}, { platform: 'xbox' }), NOW)).toBe(false);
    expect(compatible(a, seeker({}, { language: 'es' }), NOW)).toBe(false);
    expect(compatible(a, seeker({ lowTrust: true }), NOW)).toBe(false);
    const b = seeker();
    expect(compatible({ ...a, avoid: [b.userId] }, b, NOW)).toBe(false);
    expect(compatible(a, b, NOW)).toBe(true);
  });

  it('mixes NA East and West only after 3 minutes, and keeps other regions apart', () => {
    const east = seeker();
    const west = seeker({}, { region: 'naw' });
    expect(compatible(east, west, NOW)).toBe(false);
    expect(compatible({ ...east, since: NOW - 3 * MINUTE }, west, NOW)).toBe(true);
    expect(compatible({ ...east, since: NOW - 30 * MINUTE }, seeker({}, { region: 'eu' }), NOW)).toBe(false);
  });

  it('keeps new players and veterans apart for the first 2 minutes', () => {
    const fresh = seeker({}, { experience: 'new' });
    const veteran = seeker({}, { experience: 'veteran' });
    expect(compatible(fresh, veteran, NOW)).toBe(false);
    expect(compatible({ ...fresh, since: NOW - 2 * MINUTE }, veteran, NOW)).toBe(true);
  });

  it('scores a perfect fit 100 and a poor one low', () => {
    expect(pairScore(seeker(), seeker())).toBe(100);
    const poor = pairScore(seeker(), seeker({ mode: 'base' }, { playstyles: ['base'], mic: 'no', experience: 'new', server: 'community' }));
    expect(poor).toBeLessThan(25);
    expect(scoreThreshold(0)).toBeGreaterThan(poor);
  });

  it('forms a duo from two good fits at once', () => {
    const a = seeker();
    const b = seeker();
    const matches = formSquads([a, b], NOW);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.members.map((member) => member.userId).sort()).toEqual([a.userId, b.userId].sort());
  });

  it('fills a squad of 4 with the best fits and leaves the poor fit out', () => {
    const anchor = seeker({ size: 4, since: NOW - MINUTE });
    const good = [seeker({ size: 4 }), seeker({ size: 0 }), seeker({ size: 4 })];
    const poor = seeker({ size: 4, mode: 'base' }, { playstyles: ['base'], mic: 'no', server: 'community' });
    const matches = formSquads([anchor, ...good, poor], NOW);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.members).toHaveLength(4);
    expect(matches[0]!.members.map((member) => member.userId)).not.toContain(poor.userId);
  });

  it('waits for a full squad, then accepts a smaller one after 5 minutes', () => {
    const a = seeker({ size: 4 });
    const b = seeker({ size: 4 });
    expect(formSquads([a, b], NOW)).toHaveLength(0);
    expect(formSquads([{ ...a, since: NOW - 5 * MINUTE }, { ...b, since: NOW - 5 * MINUTE }], NOW)).toHaveLength(1);
  });

  it('lowers the bar the longer the anchor waits', () => {
    const a = seeker({ mode: 'pvp' });
    const b = seeker({ mode: 'pve' }, { playstyles: ['pve'], mic: 'listen' });
    const score = groupScore([a, b]);
    expect(score).toBeLessThan(scoreThreshold(0));
    expect(formSquads([a, b], NOW)).toHaveLength(0);
    expect(formSquads([{ ...a, since: NOW - 6 * MINUTE }, b], NOW)).toHaveLength(score >= scoreThreshold(6 * MINUTE) ? 1 : 0);
  });

  it('gives Elite Supporters the head of the line', () => {
    const early = seeker({ since: NOW - MINUTE });
    const elite = seeker({ since: NOW, elite: true });
    const third = seeker();
    // Only one duo can form from three; the anchor is whoever has (counted as) waited longest.
    const [match] = formSquads([early, elite, third], NOW);
    expect(ELITE_HEAD_START_MS).toBeGreaterThan(MINUTE);
    expect(match!.members[0]!.userId).toBe(elite.userId);
  });

  it('fills an open squad slot with the best fitting member', () => {
    const squad = [seeker({ size: 0 }), seeker({ size: 0 })];
    const good = seeker({ size: 0 });
    const wantsDuo = seeker({ size: 2 });
    const other = seeker({}, { platform: 'xbox' });
    const joiner = bestJoiner(squad, [wantsDuo, other, good], NOW);
    expect(joiner?.members[0]!.userId).toBe(good.userId);
  });
});

describe('squad finder reputation', () => {
  it('turns low-trust at 3 different reporters within 60 days', () => {
    const rep = readRep({ betrayedBy: { a: NOW, b: NOW } });
    expect(isLowTrust(rep, NOW)).toBe(false);
    rep.betrayedBy.c = NOW;
    expect(LOW_TRUST_REPORTS).toBe(3);
    expect(isLowTrust(rep, NOW)).toBe(true);
    expect(isLowTrust(rep, NOW + 61 * 24 * 60 * MINUTE)).toBe(false);
  });

  it('applies commendations, play again and private reports, and flags a member who becomes low-trust', () => {
    const players = {};
    lfgPlayerOf(players, 'target').rep.betrayedBy = { r1: NOW, r2: NOW };
    const flagged = applyRatings(
      players,
      'rater',
      { target: { commends: ['trust'], again: true, betrayed: true }, mate: { commends: ['comms', 'comms', 'clutch'], again: true, betrayed: false } },
      NOW,
      (rep) => isLowTrust(rep, NOW),
    );
    expect(flagged).toEqual(['target']);
    const target = lfgPlayerOf(players, 'target').rep;
    expect(target.commends.trust).toBe(0);
    expect(target.betrayedBy.rater).toBe(NOW);
    const mate = lfgPlayerOf(players, 'mate').rep;
    expect(mate.commends).toMatchObject({ comms: 1, clutch: 1 });
    expect(lfgPlayerOf(players, 'rater').rep.playAgain).toEqual(['mate']);
  });

  it('forgets ended squads once their ratings window has passed', () => {
    const squads = {
      old: { endedAt: NOW - RATING_WINDOW_MS - 1, channelsDeleted: true },
      fresh: { endedAt: NOW - 1000, channelsDeleted: true },
      live: { endedAt: null, channelsDeleted: false },
    } as never;
    pruneSquads(squads, NOW);
    expect(Object.keys(squads)).toEqual(['fresh', 'live']);
  });
});

describe('squad finder screens', () => {
  it('fits Discord limits', () => {
    const editor = cardEditorView(dayz, { platform: 'ps' }, 1);
    expect(editor.components.length).toBeLessThanOrEqual(5);
    expect(cardEditorView(dayz, {}, 2).components.length).toBeLessThanOrEqual(5);
    const panel = panelView(dayz, { searching: [seeker(), seeker({}, { platform: 'xbox', region: 'eu' })], active: 2, formedToday: 5, open: 1 });
    expect(JSON.stringify(panel.embeds[0]!.toJSON())).toContain('Europe **1**');
    const squad = {
      id: 'sq1',
      community: 'dayz',
      guildId: 'g',
      callSign: 'Bravo 4821',
      platform: 'ps',
      region: 'nae',
      language: 'en',
      mode: 'pvp',
      score: 91,
      members: ['1', '2', '3', '4', '5'],
      former: [],
      textId: 't',
      voiceId: 'v',
      createdAt: NOW,
      open: false,
      openedAt: 0,
      endedAt: null,
      endReason: null,
      channelsDeleted: false,
      rated: [],
    } as import('../src/lfg/lfgStore.js').SquadRecord;
    const intro = squadIntroView(dayz, squad, [], null);
    expect(intro.content).toContain('<@5>');
    const rating = ratingView(squad, ['2', '3', '4', '5'].map((memberId) => ({ id: memberId, name: `Member ${memberId}` })));
    expect(rating.components.length).toBeLessThanOrEqual(5);
    const check = readyCheckView(
      { id: 'c', community: dayz, members: [seeker(), seeker()], score: 88, accepted: new Set(), declined: new Set(), expires: NOW + 120000, join: null },
      'open',
    );
    expect(check.components).toHaveLength(1);
  });
});

describe('more than one game community', () => {
  const bf6 = rules.communityOf('bf6')!;

  it('matches Battlefield 6 players across platforms, and keeps DayZ to one platform', () => {
    const ps = seeker({ community: 'bf6', mode: 'obj' }, { platform: 'ps', playstyles: ['obj'], server: 'large' });
    const pc = seeker({ community: 'bf6', mode: 'obj' }, { platform: 'pc', playstyles: ['obj'], server: 'large' });
    expect(compatible(ps, pc, NOW)).toBe(true);
    expect(compatible(seeker(), seeker({}, { platform: 'xbox' }), NOW)).toBe(false);
    // Different communities never mix.
    expect(compatible(ps, seeker(), NOW)).toBe(false);
  });

  it('only accepts the platforms a game is on', () => {
    expect(readCard({ ...card(), platform: 'pc' }, dayz)).toBeNull();
    expect(readCard({ ...card(), platform: 'pc', playstyles: ['obj'], server: 'redsec' }, bf6)).toMatchObject({ platform: 'pc', server: 'redsec' });
    expect(readCard({ ...card(), playstyles: ['obj'], server: 'daynite' }, bf6)).toBeNull();
  });

  it('never forms a Battlefield 6 squad over 4', () => {
    const players = Array.from({ length: 6 }, () => seeker({ community: 'bf6', mode: 'obj', size: 0 }, { playstyles: ['obj'], server: 'large' }));
    const [match] = formSquads(players, NOW);
    expect(match!.members).toHaveLength(4);
    const view = rules.SIZES;
    expect(Object.keys(view).filter((size) => Number(size) <= bf6.maxSquad)).not.toContain('5');
  });

  it('names the card after the game', () => {
    expect(cardEditorView(bf6, {}, 1).embeds[0]!.toJSON().title).toContain('Soldier ID');
    expect(cardEditorView(dayz, {}, 1).embeds[0]!.toJSON().title).toContain('Survivor ID');
  });
});

describe('the GTA V community', () => {
  const gta = rules.communityOf('gta5')!;
  const gtaSeeker = (platform: import('../src/lfg/lfgRules.js').Platform) =>
    seeker({ community: 'gta5', mode: 'heists' }, { platform, playstyles: ['heists'], server: 'public' });

  it('keeps PS5 and PS4 (and Xbox Series and Xbox One) apart', () => {
    expect(compatible(gtaSeeker('ps5'), gtaSeeker('ps5'), NOW)).toBe(true);
    expect(compatible(gtaSeeker('ps5'), gtaSeeker('ps4'), NOW)).toBe(false);
    expect(compatible(gtaSeeker('xsx'), gtaSeeker('xone'), NOW)).toBe(false);
  });

  it('takes a Crew ID with its own consoles', () => {
    expect(readCard({ ...card(), platform: 'ps5', playstyles: ['heists'], server: 'crew' }, gta)).toMatchObject({ platform: 'ps5' });
    expect(readCard({ ...card(), platform: 'ps', playstyles: ['heists'], server: 'crew' }, gta)).toBeNull();
    expect(cardEditorView(gta, {}, 1).embeds[0]!.toJSON().title).toContain('Crew ID');
  });
});
