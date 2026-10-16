import { describe, expect, it } from 'vitest';
import { ConversationMemory, type ConversationSession, type FollowUpIntent, type TuningState } from '../src/ai/conversationMemory.js';
import { buildTCPPrompt } from '../src/ai/promptBuilder.js';
import { recordedPullReply } from '../src/ai/pullFollowUp.js';
import { clampScale, detectRecordedPull, extractQuestionDetails } from '../src/ai/question.js';
import { buildRetrievalQuery } from '../src/ai/retrievalQuery.js';
import { systemPrompt } from '../src/ai/systemPrompt.js';
import { KnowledgeService } from '../src/knowledge/knowledgeService.js';

// T.C.P Premium: while a Weapon Workshop slot with a recorded pull is selected (home screen: the slot, e.g.
// "W1 M4-A1", and a PULL badge), Vertical and Horizontal Recoil are locked and Up/Down just buzzes. That gun
// is tuned with Scale Y (up/down) and Scale X (sideways) on the Workshop page, 50 to 150%, default 100, one
// per press. These pin that the fixed tuning follow-ups use Scale Y there, and nothing else changes.

// AssistantService reads the bot's environment when it loads, so give it the required values first.
process.env.DISCORD_TOKEN ??= 'test-token';
process.env.DISCORD_CLIENT_ID ??= 'test-client';
process.env.DISCORD_GUILD_ID ??= 'test-guild';
const { AssistantService } = await import('../src/ai/assistantService.js');
const assistant = new AssistantService(new KnowledgeService());

async function reply(intent: FollowUpIntent, state: TuningState): Promise<string> {
  return (await assistant.answerDetailed('still', [], undefined, state, intent)).text;
}

/** One player message through the memory, the fixed replies and record(), as the bot's handlers do it. */
async function turn(memory: ConversationMemory, session: ConversationSession, question: string): Promise<string> {
  const intent = memory.updateFromQuestion(session, extractQuestionDetails(question), question);
  const text = (await assistant.answerDetailed(question, session.turns, undefined, session.tuning, intent)).text;
  memory.record(session, question, text);
  return text;
}

describe('fixed tuning replies on a recorded pull', () => {
  it('raises Scale Y by 5 when it still climbs, with the value when it is known', async () => {
    expect(await reply('TEST_RESULT', { onRecordedPull: true, scaleY: 100, currentSymptom: 'CLIMBING' }))
      .toBe('Since Scale Y 100 is still climbing, raise Scale Y to 105 next (press Up 5 times). Keep Scale X unchanged so we are testing one variable.');
  });

  it('says where Scale Y is, and that Vertical is locked, when the value is not known', async () => {
    const text = await reply('TEST_RESULT', { onRecordedPull: true, vertical: 25, currentSymptom: 'CLIMBING' });
    expect(text).toBe('Vertical Recoil is locked while a recorded pull is selected, so raise Scale Y instead: Workshop page (27/27, LEFT once from Master), L1/R1 to Scale Y (4/6), then press Up 5 times (+5%; it starts at 100). Keep Scale X unchanged so we are testing one variable.');
    expect(text).not.toContain('try 26');
  });

  it('moves Scale Y back toward the previous value once it pulls down', async () => {
    expect(await reply('TEST_RESULT', { onRecordedPull: true, scaleY: 105, previousScaleY: 100, currentSymptom: 'PULLING_DOWN' }))
      .toBe('You have crossed the balance point. Move Scale Y back toward 100: set Scale Y to 102 (press Down 3 times) and retest.');
  });

  it('lowers Scale Y when it pulls down without a previous value, known or not', async () => {
    expect(await reply('TEST_RESULT', { onRecordedPull: true, scaleY: 100, currentSymptom: 'PULLING_DOWN' }))
      .toBe('Since Scale Y 100 pulls down, lower Scale Y to 95 next (press Down 5 times) and retest.');
    expect(await reply('TEST_RESULT', { onRecordedPull: true, vertical: 25, previousVertical: 24, currentSymptom: 'PULLING_DOWN' }))
      .toBe('Vertical Recoil is locked while a recorded pull is selected, so lower Scale Y instead: Workshop page (27/27, LEFT once from Master), L1/R1 to Scale Y (4/6), then press Down 5 times (-5%; it starts at 100). Keep Scale X unchanged so we are testing one variable.');
  });

  it('keeps Scale Y when it is stable or fixed, and says it saves when the menu closes', async () => {
    expect(await reply('TEST_RESULT', { onRecordedPull: true, scaleY: 105, vertical: 25, currentSymptom: 'STABLE' }))
      .toBe('Perfect. Keep Scale Y at 105; it saves when you close the menu.');
    expect(await reply('TEST_RESULT', { onRecordedPull: true, currentSymptom: 'STABLE' }))
      .toBe('Perfect. Keep Scale Y where it is; it saves when you close the menu.');
    expect(await reply('RESOLVED', { onRecordedPull: true, scaleY: 110 }))
      .toBe('Perfect. Keep Scale Y at 110; it saves when you close the menu. We can tune Scale X or ADS separately if you need to.');
  });

  it('raises back toward a higher previous value when it climbs again, and stops between two neighbours', async () => {
    expect(await reply('TEST_RESULT', { onRecordedPull: true, scaleY: 102, previousScaleY: 105, currentSymptom: 'CLIMBING' }))
      .toBe('Since Scale Y 102 is still climbing, raise Scale Y to 104, back toward 105 (press Up 2 times), and retest.');
    expect(await reply('TEST_RESULT', { onRecordedPull: true, scaleY: 103, previousScaleY: 104, currentSymptom: 'CLIMBING' }))
      .toBe('The balance point is between Scale Y 103 and 104. Keep whichever feels better; it saves when you close the menu.');
  });

  it('stays inside 50 to 150 and sends a player at either end to REDO the slot', async () => {
    expect(await reply('TEST_RESULT', { onRecordedPull: true, scaleY: 148, currentSymptom: 'CLIMBING' }))
      .toBe('Since Scale Y 148 is still climbing, raise Scale Y to 150 next (press Up 2 times). Keep Scale X unchanged so we are testing one variable.');
    expect(await reply('TEST_RESULT', { onRecordedPull: true, scaleY: 150, currentSymptom: 'CLIMBING' }))
      .toBe('Scale Y is already at its 150 maximum. REDO that slot (Record, 3/6 on the Workshop page) so the recorded pull itself is stronger.');
    expect(await reply('TEST_RESULT', { onRecordedPull: true, scaleY: 53, currentSymptom: 'PULLING_DOWN' }))
      .toBe('Since Scale Y 53 pulls down, lower Scale Y to 50 next (press Down 3 times) and retest.');
    expect(await reply('TEST_RESULT', { onRecordedPull: true, scaleY: 50, currentSymptom: 'PULLING_DOWN' }))
      .toBe('Scale Y is already at its 50 minimum. REDO that slot (Record, 3/6 on the Workshop page) and hold the mark steady while you record.');
  });

  it('never mentions Vertical in a reply that changes or keeps Scale Y', () => {
    const states: TuningState[] = [
      { onRecordedPull: true, scaleY: 100, vertical: 25, currentSymptom: 'CLIMBING' },
      { onRecordedPull: true, scaleY: 105, previousScaleY: 100, vertical: 25, previousVertical: 24, currentSymptom: 'PULLING_DOWN' },
      { onRecordedPull: true, scaleY: 100, vertical: 25, currentSymptom: 'STABLE' },
    ];
    for (const state of states) expect(recordedPullReply('TEST_RESULT', state)).not.toMatch(/vertical/i);
  });

  it('leaves drift and other symptoms to the AI, not to the Vertical replies', () => {
    expect(recordedPullReply('TEST_RESULT', { onRecordedPull: true, scaleY: 100, currentSymptom: 'DRIFTING_LEFT' })).toBeUndefined();
    expect(recordedPullReply('TESTING', { onRecordedPull: true, scaleY: 100 })).toBeUndefined();
    expect(recordedPullReply('TEST_RESULT', { scaleY: 100, currentSymptom: 'CLIMBING' })).toBeUndefined();
  });
});

describe('the Vertical replies without a recorded pull are unchanged', () => {
  for (const onRecordedPull of [undefined, false]) {
    it(`with onRecordedPull ${String(onRecordedPull)}`, async () => {
      expect(await reply('TEST_RESULT', { onRecordedPull, vertical: 25, scaleY: 105, currentSymptom: 'CLIMBING' }))
        .toBe('Since 25 is still climbing, try 26 next. Keep Horizontal unchanged so we are testing one variable.');
      expect(await reply('TEST_RESULT', { onRecordedPull, vertical: 27, previousVertical: 26, currentSymptom: 'PULLING_DOWN' }))
        .toBe('You have crossed the balance point. Move Vertical back toward 26 and retest.');
      expect(await reply('TEST_RESULT', { onRecordedPull, vertical: 26, currentSymptom: 'STABLE' }))
        .toBe('Perfect. Keep Vertical at 26 and save that value.');
      expect(await reply('RESOLVED', { onRecordedPull, vertical: 26 }))
        .toBe('Perfect. Save that value. We can tune Horizontal or ADS separately if you need to.');
      expect(await reply('TESTING', { onRecordedPull, vertical: 26 }))
        .toBe('Sounds good. Keep the weapon, optic, and distance the same for the test. When you are done, tell me if it still climbs, pulls down, or feels centered.');
    });
  }
});

describe('knowing when a player is on a recorded pull', () => {
  it.each([
    'home screen shows W1 M4-A1 PULL',
    'it has the pull badge',
    'it says PULL: SCALE Y when i press up',
    'my recorded pull still climbs',
    'I recorded a pull for my akm',
    'my recording still climbs',
    'scale y is 105',
    'i use the workshop for my m4',
    'on w3 now',
  ])('"%s" sets it', (question) => {
    expect(detectRecordedPull(question)).toBe(true);
  });

  it.each([
    'i set weapon off',
    'Weapon is OFF now',
    'the badge says STD',
    'no recording yet',
    "I haven't recorded it",
    'scale y says RECORD FIRST',
    'W2 says STD',
  ])('"%s" clears it', (question) => {
    expect(detectRecordedPull(question)).toBe(false);
  });

  it.each([
    'still climbing',
    'it keeps pulling down',
    'IT STILL PULL DOWN',
    'what is the workshop',
    'is the workshop free',
    'where is the workshop page',
    'my vertical is 25',
  ])('"%s" leaves it as it was', (question) => {
    expect(detectRecordedPull(question)).toBeUndefined();
  });

  it('follows the player through a session: set, kept, cleared, set again', () => {
    const memory = new ConversationMemory();
    const session = memory.getOrCreate('guild', 'channel', 'user');
    const say = (question: string) => memory.updateFromQuestion(session, extractQuestionDetails(question), question);
    say('home screen shows W1 M4-A1 PULL V28 H4');
    expect(session.tuning).toMatchObject({ onRecordedPull: true, workshopSlot: 'W1' });
    say('still climbing');
    expect(session.tuning.onRecordedPull).toBe(true);
    say('ok i set weapon off');
    expect(session.tuning.onRecordedPull).toBe(false);
    expect(session.tuning.pullVertical).toBeUndefined();
    say('back on my recording');
    expect(session.tuning.onRecordedPull).toBe(true);
    say('W2 shows STD');
    expect(session.tuning).toMatchObject({ onRecordedPull: false, workshopSlot: 'W2' });
  });

  it('reads V28 H4 on a pull as the recorded pull, never as Vertical or Horizontal', () => {
    const memory = new ConversationMemory();
    const session = memory.getOrCreate('guild', 'channel', 'user');
    const question = 'home screen shows W1 M4-A1 PULL V28 H4 and it still climbs';
    expect(extractQuestionDetails(question)).not.toHaveProperty('vertical');
    memory.updateFromQuestion(session, extractQuestionDetails(question), question);
    expect(session.tuning).toMatchObject({ onRecordedPull: true, pullVertical: 28, pullHorizontal: 4, currentSymptom: 'CLIMBING' });
    expect(session.tuning.vertical).toBeUndefined();
    expect(session.tuning.horizontal).toBeUndefined();
    // Later V/H readings on the same pull update the pull, not Vertical.
    memory.updateFromQuestion(session, extractQuestionDetails('now it shows V30 H-2'), 'now it shows V30 H-2');
    expect(session.tuning).toMatchObject({ pullVertical: 30, pullHorizontal: -2 });
    expect(session.tuning.vertical).toBeUndefined();
  });

  it('ignores the home screen V and H when no pull fires, as before', () => {
    const memory = new ConversationMemory();
    const session = memory.getOrCreate('guild', 'channel', 'user');
    memory.updateFromQuestion(session, extractQuestionDetails('home screen says V25 H3'), 'home screen says V25 H3');
    expect(session.tuning.vertical).toBeUndefined();
    expect(session.tuning.pullVertical).toBeUndefined();
  });
});

describe('Scale Y and Scale X values', () => {
  it.each([
    ['scale y 110', 110],
    ['scale y is 105', 105],
    ['scale y at 95%', 95],
    ['Scale Y is now at 120', 120],
    ['scale-y: 100', 100],
    ['scale y 102.6', 103],
    ['scale y 200', 150],
    ['scale y 20', 50],
  ])('"%s" reads Scale Y %i', (question, value) => {
    expect(extractQuestionDetails(question).scaleY).toBe(value);
  });

  it('does not read a page position or a step as a value', () => {
    expect(extractQuestionDetails('scale y (4/6) just buzzes').scaleY).toBeUndefined();
    expect(extractQuestionDetails('should i raise scale y by 5').scaleY).toBeUndefined();
  });

  it('reads Scale X apart from Scale Y', () => {
    expect(extractQuestionDetails('scale x 90 and scale y 105')).toMatchObject({ scaleX: 90, scaleY: 105, recordedPull: true });
  });

  it('keeps the previous Scale Y like the previous Vertical, and clamps', () => {
    expect(clampScale(151)).toBe(150);
    expect(clampScale(49)).toBe(50);
    const memory = new ConversationMemory();
    const session = memory.getOrCreate('guild', 'channel', 'user');
    const say = (question: string) => memory.updateFromQuestion(session, extractQuestionDetails(question), question);
    say('W1 PULL, scale y 100');
    say('changed scale y to 110');
    expect(session.tuning).toMatchObject({ scaleY: 110, previousScaleY: 100 });
    say('scale y 300');
    expect(session.tuning).toMatchObject({ scaleY: 150, previousScaleY: 110 });
  });

  it('forgets one slot\'s scales and pull when the player names another slot', () => {
    const memory = new ConversationMemory();
    const session = memory.getOrCreate('guild', 'channel', 'user');
    const say = (question: string) => memory.updateFromQuestion(session, extractQuestionDetails(question), question);
    say('W1 PULL V28 H4, scale y 110, scale x 95');
    say('switched to W2 PULL');
    expect(session.tuning).toMatchObject({ workshopSlot: 'W2', onRecordedPull: true });
    expect(session.tuning.scaleY).toBeUndefined();
    expect(session.tuning.scaleX).toBeUndefined();
    expect(session.tuning.pullVertical).toBeUndefined();
  });

  it('record() follows Scale Y and Scale X recommendations, clamped to 50-150', () => {
    const memory = new ConversationMemory();
    const session = memory.getOrCreate('guild', 'channel', 'user');
    session.tuning = { onRecordedPull: true, scaleY: 100 };
    memory.record(session, 'still climbing', 'Try Scale Y 110 and fire a few bursts.');
    expect(session.tuning).toMatchObject({ scaleY: 110, previousScaleY: 100, waitingForTestResult: true });
    memory.record(session, 'still climbing', 'Raise Scale Y to 180 next.');
    expect(session.tuning).toMatchObject({ scaleY: 150, previousScaleY: 110 });
    memory.record(session, 'pulls down now', 'Lower Scale Y at 30.');
    expect(session.tuning).toMatchObject({ scaleY: 50, previousScaleY: 150 });
    memory.record(session, 'drifts right', 'Lower Scale X to 90 and retest.');
    expect(session.tuning.scaleX).toBe(90);
    memory.record(session, 'ok', 'Raise Scale Y by 5 (press Up 5 times).');
    expect(session.tuning.scaleY).toBe(50);
  });
});

describe('a whole Scale Y session', () => {
  it('climbs, crosses and settles without ever touching Vertical', async () => {
    const memory = new ConversationMemory();
    const session = memory.getOrCreate('guild', 'channel', 'user');
    expect(await turn(memory, session, 'home screen shows W1 M4-A1 PULL V28 H4, scale y 100, still climbing'))
      .toBe('Since Scale Y 100 is still climbing, raise Scale Y to 105 next (press Up 5 times). Keep Scale X unchanged so we are testing one variable.');
    expect(session.tuning).toMatchObject({ scaleY: 105, previousScaleY: 100 });
    expect(await turn(memory, session, 'now its pulling down'))
      .toBe('You have crossed the balance point. Move Scale Y back toward 100: set Scale Y to 102 (press Down 3 times) and retest.');
    expect(session.tuning).toMatchObject({ scaleY: 102, previousScaleY: 105 });
    expect(await turn(memory, session, 'it is stable now'))
      .toBe('Perfect. Keep Scale Y at 102; it saves when you close the menu.');
    expect(session.tuning.vertical).toBeUndefined();
    expect(session.tuning).toMatchObject({ pullVertical: 28, pullHorizontal: 4, workshopSlot: 'W1' });
  });
});

describe('the AI sees the recorded pull', () => {
  it('puts the Workshop fields in the TUNING SESSION and the rule in the system prompt', () => {
    const state: TuningState = { onRecordedPull: true, workshopSlot: 'W1', pullVertical: 28, pullHorizontal: 4, scaleY: 105, previousScaleY: 100, scaleX: 100 };
    const prompt = buildTCPPrompt({ question: 'still climbing', details: {}, retrievedChunks: [], tuningState: state });
    for (const field of ['"onRecordedPull":true', '"workshopSlot":"W1"', '"pullVertical":28', '"pullHorizontal":4', '"scaleY":105', '"previousScaleY":100', '"scaleX":100']) {
      expect(prompt.context).toContain(field);
    }
    expect(systemPrompt).toContain('When the TUNING SESSION says onRecordedPull is true, tune that player only with Scale Y (up/down) and Scale X (sideways), 50 to 150% in small steps, never Vertical or Horizontal');
    expect(prompt.system).toContain('onRecordedPull is true');
  });

  it('searches the Scale Y section for a vague follow-up on a pull', async () => {
    const query = buildRetrievalQuery('still climbing', extractQuestionDetails('still climbing'), { onRecordedPull: true, scaleY: 105, currentSymptom: 'CLIMBING' });
    expect(query).toContain('recorded pull');
    expect(query).toContain('scale y 105');
    const [first] = await new KnowledgeService().search(query, 5);
    expect(first?.chunk.heading).toBe('Workshop: Scale Y and Scale X');
    expect(buildRetrievalQuery('still climbing', {}, { vertical: 25, scaleY: 105 })).not.toContain('scale y');
  });
});
