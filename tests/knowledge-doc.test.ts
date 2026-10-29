import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DocumentParser } from '../src/knowledge/documentParser.js';
import { KeywordRetriever } from '../src/knowledge/retriever.js';
import { KnowledgeService } from '../src/knowledge/knowledgeService.js';
import { buildTCPPrompt } from '../src/ai/promptBuilder.js';
import { extractQuestionDetails } from '../src/ai/question.js';
import { buildRetrievalQuery } from '../src/ai/retrievalQuery.js';

// Questions players actually ask, run against the real documentation. If the doc's headings or the
// retriever change, these show which answers would now come from the wrong section.
const chunks = new DocumentParser().parse(readFileSync('knowledge/T.C.P_DOCUMENTATION.md', 'utf8'));
const retriever = new KeywordRetriever(chunks);

async function topHeading(question: string): Promise<string | undefined> {
  return (await retriever.search(question, 1))[0]?.chunk.heading;
}

describe('documentation retrieval', () => {
  it.each([
    ['what does vertical do', 'Vertical and Horizontal Recoil'],
    ['how do i unlock the script', 'How to unlock'],
    ['what does easing do', 'Easing'],
    ['what is lean spam for', 'Lean Spam'],
    ['how do i switch profile', 'ADS Profiles'],
    ['what does precision do', 'Precision'],
    ['my moonwalk keeps stopping', 'Auto Movement (moonwalk)'],
    ['gun keeps climbing', 'Gun climbs during a burst'],
    ['my trial ended', 'Free trial'],
    ['how do i calibrate', 'Calibrate Recoil'],
    ['aim feels laggy', 'Aim feels laggy or floaty'],
    ['what is anti deadzone', 'Anti Deadzone'],
    ['what does fire sens do', 'Fire Sens'],
    ['crouch shot', 'Drop Shot and Crouch Shot'],
    ['my code does not work', 'Problems getting a code'],
    ['how do i open a ticket', 'Opening a support ticket'],
    ['where can i ask a question', 'Asking the assistant'],
    ['what does the get started button do', 'The Get started button'],
    // "turn" is in the Turn Strength heading; questions about turning a feature on or off must not land there.
    ['how do i turn on lean spam', 'Lean Spam'],
    ['how do i turn off auto run', 'Auto Run'],
  ])('"%s" finds %s', async (question, heading) => {
    expect(await topHeading(question)).toBe(heading);
  });

  it('documents the current 26-page menu, not the old 12-page one', () => {
    const text = readFileSync('knowledge/T.C.P_DOCUMENTATION.md', 'utf8');
    expect(text).toContain('26 pages');
    expect(text).not.toMatch(/12[- ]page/i);
  });

  it('keeps the root copy of the documentation identical to the one the bot loads', () => {
    const lf = (path: string) => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
    expect(lf('T.C.P_DOCUMENTATION.md')).toBe(lf('knowledge/T.C.P_DOCUMENTATION.md'));
  });
});

// Turn Strength's name reads the wrong way round: higher means LESS recoil control while the stick moves.
// The bot once answered it backwards, so these pin the retrieval, the doc's direction and the prompt rule.
describe('Turn Strength', () => {
  const section = chunks.find((chunk) => chunk.heading === 'Turn Strength')?.content ?? '';

  it.each([
    'what does turn strength do',
    'what is turn strength',
    'turn strength explained',
    'should I lower turn strength',
    'turn strenght?',
    'what does 100 turn strength mean',
    'turn strength 0 vs 100',
    'is higher turn strength more recoil control',
    'what does turning strength do',
  ])('"%s" finds Turn Strength, as typed and as the bot searches', async (question) => {
    expect(await topHeading(question)).toBe('Turn Strength');
    const botQuery = buildRetrievalQuery(question, extractQuestionDetails(question));
    expect((await retriever.search(botQuery, 1))[0]?.chunk.heading).toBe('Turn Strength');
  });

  it('says 0 never lets flicks weaken the pull and 100 weakens it the most', () => {
    expect(section).toContain('**Turn Strength 100** (default): the pull is cut by 60%, leaving 40% of it. Moving the stick weakens it the most.');
    expect(section).toContain('**Turn Strength 50**: the pull is cut by 30%, leaving 70% of it.');
    expect(section).toContain('**Turn Strength 0**: the pull is not cut at all. Flicks and tracking never weaken it.');
    // A bare "**0**" next to "100%" is how a small model turns it back into "100 = full pull"; name the setting every time.
    expect(section).not.toMatch(/\*\*\d+\*\*/);
    expect(section).toContain('Pulling down yourself still takes part of the pull off at any value, and so does Motion Intel if you turn it on.');
    expect(section).toContain('letting the stick rest near centre for a moment restores it');
    expect(section).toContain('Higher Turn Strength means less recoil control while you move the stick');
    expect(section).toMatch(/name is misleading/i);
  });

  it('agrees with the other places that mention it', () => {
    const content = (heading: string) => chunks.find((chunk) => chunk.heading === heading)?.content ?? '';
    expect(content('How anti-recoil reacts to your stick')).toContain('Turn Strength sets how much of the flick and tracking weakening applies: at 100 it applies fully, at 0 flicks and tracking never weaken the pull.');
    expect(content('How anti-recoil reacts to your stick')).toContain('Letting the stick rest near centre for a moment restores full strength');
    expect(content('Hard to stay on target while shooting')).toContain('lower Turn Strength (around 40) so moving the stick weakens the pull less');
    expect(content('Gun climbs during a burst')).toContain('lower Turn Strength instead');
    expect(content('Aim gets pulled down / sinks')).toContain('If it only drags down when switching targets (flicking to a new target) and you have lowered Turn Strength, raise Turn Strength back toward 100.');
  });

  // The "keep 100 if the pull drags your aim down" advice lives in the Turn Strength section, which a
  // dragged-down question does not retrieve; the sinks section must carry it, or the bot only says lower Vertical.
  it.each([
    'my aim gets dragged down when I flick to a new target',
    'aim drags down when switching targets',
  ])('"%s" brings the sinks section and its Turn Strength advice into the prompt', async (question) => {
    const botQuery = buildRetrievalQuery(question, extractQuestionDetails(question));
    for (const query of [question, botQuery]) {
      const sinks = (await retriever.search(query, 5)).find((result) => result.chunk.heading === 'Aim gets pulled down / sinks');
      expect(sinks?.chunk.content).toContain('raise Turn Strength back toward 100');
    }
  });

  it('puts the direction rule and the section in the prompt for the question', async () => {
    const question = 'what does turn strength do';
    const details = extractQuestionDetails(question);
    const prompt = buildTCPPrompt({
      question,
      details,
      retrievedChunks: await retriever.search(buildRetrievalQuery(question, details), 5),
    });

    expect(prompt.system).toContain('Turn Strength (0 to 100, default 100) sets how much moving the right stick while firing weakens the recoil pull.');
    expect(prompt.system).toContain('Higher means moving the stick weakens the pull more (less recoil control while moving); at 0 flicks and tracking never weaken the pull (pulling down yourself, and Motion Intel if it is on, still can).');
    expect(prompt.system).toContain('raise it back toward 100 if the pull drags the aim down when flicking to a new target');
    expect(prompt.system).not.toContain('0 keeps the full pull');
    expect(prompt.system).toContain('it is not the strength of the recoil control');
    expect(prompt.context).toContain(`[Anti-Recoil > Turn Strength]\n${section}`);
  });
});

// The Circle double tap used to be always on with Drop Shot. Since 2026-10-14 it is its own Double Tap
// switch, off by default (a quick Circle double tap is crouch then stand in DayZ), so the doc must not say
// it is always available.
describe('Drop Shot', () => {
  const content = (heading: string) => chunks.find((chunk) => chunk.heading === heading)?.content ?? '';
  const section = content('Drop Shot and Crouch Shot');

  it.each([
    'double tap circle goes prone',
    'double tap circle makes me go prone',
    'why do i go prone when i double tap circle',
    // Without the retriever's double tap aliases most of these went to Menu Pages, Turn Strength or the defaults.
    'double tap not working',
    'how do I turn on double tap',
    'how do i turn off double tap',
    'double tap prone',
    'my double tap stopped working after the update',
    'is double tap on by default',
    'double-tap to prone stopped working',
    'doubletap prone?',
    'double tapping circle does nothing',
  ])('"%s" finds Drop Shot, as typed and as the bot searches', async (question) => {
    expect(await topHeading(question)).toBe('Drop Shot and Crouch Shot');
    const botQuery = buildRetrievalQuery(question, extractQuestionDetails(question));
    expect((await retriever.search(botQuery, 1))[0]?.chunk.heading).toBe('Drop Shot and Crouch Shot');
  });

  it('says Double Tap is off by default and Drop Shot does nothing until a trigger is on', () => {
    expect(section).toContain('**Double Tap** (default off): two Circle presses within 280 ms drop you prone.');
    expect(section).toContain('With it off, your Circle presses reach the game untouched.');
    expect(section).toContain('Both are off by default, so Drop Shot does nothing until you switch one of them on.');
    expect(section).not.toMatch(/always available/i);
  });

  it('documents Drop Roll as a Premium switch, off by default', () => {
    expect(content('Drop Roll (Premium)')).toContain('double-press L1');
    expect(content('Drop Roll (Premium)')).toContain('it is off by default');
    expect(content('Drop Roll (Premium)')).toContain('go to the **DROP ROLL** group (LEFT three times from MASTER');
    expect(content('Menu Pages')).toContain('11. **DROP ROLL** (six items: on/off, Stand Up, Active Window, Shoulder On, Shoulder Off, LX Reversal');
    expect(content('Defaults and ranges')).toContain('Drop Roll and Rapid Fire (Premium) are off.');
  });

  it('lists Double Tap on the menu page and with the defaults', () => {
    expect(content('Menu Pages')).toContain('8. Drop Shot (seven items: on/off, Double Tap, Drop on Fire, Stand Up After, Hold Time, Cooldown, Stance)');
    expect(content('Defaults and ranges')).toContain('Lean Spam, Double Tap, Drop on Fire, Hair Triggers and Motion Intel are off.');
  });
});

describe('canned answers', () => {
  it('does not tell players ADS profiles are a legacy setting', async () => {
    const answer = await new KnowledgeService().buildAnswer('how do I switch my ads profile');
    expect(answer.content).not.toMatch(/legacy|not part of the active/i);
  });

  it('still explains that recoil patterns do not exist', async () => {
    const answer = await new KnowledgeService().buildAnswer('where is the recoil pattern setting');
    expect(answer.content).toMatch(/no recoil phases or patterns/i);
  });
});
