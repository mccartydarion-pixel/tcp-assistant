import { describe, expect, it } from 'vitest';
import { ConversationMemory, detectFollowUpIntent, type ConversationSession, type FollowUpIntent, type TuningState } from '../src/ai/conversationMemory.js';
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
    expect(text).toBe('Vertical Recoil is locked while a recorded pull is selected, so raise Scale Y instead: Workshop page (27/27, LEFT once from Master), L1/R1 to Scale Y (5/7), then press Up 5 times (+5%; it starts at 100). Keep Scale X unchanged, and tell me the Scale Y number it shows.');
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
      .toBe('Vertical Recoil is locked while a recorded pull is selected, so lower Scale Y instead: Workshop page (27/27, LEFT once from Master), L1/R1 to Scale Y (5/7), then press Down 5 times (-5%; it starts at 100). Keep Scale X unchanged, and tell me the Scale Y number it shows.');
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

  it('stays inside 50 to 150 and sends a player at either end to REDO the slot with Scale Y back at 100', async () => {
    expect(await reply('TEST_RESULT', { onRecordedPull: true, scaleY: 148, currentSymptom: 'CLIMBING' }))
      .toBe('Since Scale Y 148 is still climbing, raise Scale Y to 150 next (press Up 2 times). Keep Scale X unchanged so we are testing one variable.');
    expect(await reply('TEST_RESULT', { onRecordedPull: true, scaleY: 150, currentSymptom: 'CLIMBING' }))
      .toBe('Scale Y is already at its 150 maximum. Move Scale Y to 100 first, then REDO that slot (Record, 4/7 on the Workshop page), so the new recording has room to go either way.');
    expect(await reply('TEST_RESULT', { onRecordedPull: true, scaleY: 53, currentSymptom: 'PULLING_DOWN' }))
      .toBe('Since Scale Y 53 pulls down, lower Scale Y to 50 next (press Down 3 times) and retest.');
    expect(await reply('TEST_RESULT', { onRecordedPull: true, scaleY: 50, currentSymptom: 'PULLING_DOWN' }))
      .toBe('Scale Y is already at its 50 minimum. Move Scale Y to 100 first, then REDO that slot (Record, 4/7 on the Workshop page) and hold the mark steady while you record, so the new recording has room to go either way.');
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
    // Using the Workshop, or naming a slot, does not say that slot has a pull.
    'i use the workshop for my m4',
    'on w3 now',
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
    expect(extractQuestionDetails('scale y (5/7) just buzzes').scaleY).toBeUndefined();
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

// From the review of the first version: the pull flag must not be set by everyday words (or left unset by the
// plainest sign of a pull), the Scale Y search must remember both sides, and every reply must leave the player
// able to go on.

function newSession(): { memory: ConversationMemory; session: ConversationSession } {
  const memory = new ConversationMemory();
  return { memory, session: memory.getOrCreate('guild', 'channel', 'user') };
}

/** A message the fixed replies do not answer: the memory reads it and the AI's answer (no suggestion) is kept. */
function aiTurn(memory: ConversationMemory, session: ConversationSession, question: string): FollowUpIntent {
  const intent = memory.updateFromQuestion(session, extractQuestionDetails(question), question);
  memory.record(session, question, '(the AI answers)');
  return intent;
}

const UNKNOWN_CLIMB_REPLY = 'Vertical Recoil is locked while a recorded pull is selected, so raise Scale Y instead: Workshop page (27/27, LEFT once from Master), L1/R1 to Scale Y (5/7), then press Up 5 times (+5%; it starts at 100). Keep Scale X unchanged, and tell me the Scale Y number it shows.';
const PULL_OR_STD_REPLY = 'Before we change anything: does the home screen show PULL or STD for this gun? On PULL, Vertical and Horizontal Recoil are locked and the gun is tuned with Scale Y on the Workshop page (27/27); on STD or with Weapon OFF, your Vertical and Horizontal Recoil fire as set.';

describe('a Vertical that buzzes or is locked means a pull fires', () => {
  it.each([
    'my vertical is 25 and it just buzzes when i press up',
    'vertical recoil just buzzes',
    'my vertical is locked',
    "vertical won't go up",
    'vertical recoil is stuck',
    'my vertical is stuck at 25',
    "horizontal won't change",
    'calibrate says PULL IN USE',
  ])('"%s" sets it', (question) => {
    expect(detectRecordedPull(question)).toBe(true);
  });

  it.each([
    'my vertical is 25 and it buzzes twice when i hold L3 + R3',
    'got my vertical locked in at 26',
    "i raised vertical but it won't change anything",
    'vertical does nothing, the script is locked on the code screen',
  ])('"%s" leaves it (Master hold, "locked in", no effect, the licence lock)', (question) => {
    expect(detectRecordedPull(question)).toBeUndefined();
  });

  it('reads a Scale Y that buzzes as an empty slot, but not the PULL: SCALE Y hint', () => {
    expect(detectRecordedPull('scale y just buzzes')).toBe(false);
    expect(detectRecordedPull('scale y is at 5/7 and buzzes')).toBe(false);
    expect(detectRecordedPull('vertical says PULL: SCALE Y and buzzes')).toBe(true);
  });

  it('gives the Scale Y reply, not "try 26", after Vertical buzzed', async () => {
    const { memory, session } = newSession();
    aiTurn(memory, session, 'my vertical is 25 and it just buzzes when i press up');
    expect(session.tuning).toMatchObject({ onRecordedPull: true, vertical: 25 });
    expect(await turn(memory, session, 'ok still climbing')).toBe(UNKNOWN_CLIMB_REPLY);
  });
});

describe('the PULL and STD badges', () => {
  it('reads the badge that is named, not the one ruled out or offered', () => {
    expect(detectRecordedPull('it shows PULL not STD')).toBe(true);
    expect(detectRecordedPull('PULL, not STD')).toBe(true);
    expect(detectRecordedPull('it shows STD not PULL')).toBe(false);
    expect(detectRecordedPull('PULL or STD?')).toBeUndefined();
    expect(detectRecordedPull('is it supposed to say pull or std')).toBeUndefined();
    expect(detectRecordedPull("W1 has no pull yet")).toBe(false);
  });

  it('keeps the flag on and tunes Scale Y for "it shows PULL not STD"', async () => {
    const { memory, session } = newSession();
    aiTurn(memory, session, 'vertical 25');
    expect(await turn(memory, session, 'it shows PULL not STD, still climbing')).toBe(UNKNOWN_CLIMB_REPLY);
    expect(session.tuning.onRecordedPull).toBe(true);
  });

  it.each([
    'it says pull',
    'the home screen shows pull',
    'pull',
    'PULL',
    "it's PULL",
    'mine shows W1 M4-A1 PULL V28 H4',
  ])('"%s" (the badge, in any case) sets it', (question) => {
    expect(detectRecordedPull(question)).toBe(true);
  });

  it.each([
    'MY VERTICAL IS 25 AND IT STILL CLIMBS WHEN I PULL THE TRIGGER',
    'IT STILL PULL TO THE LEFT',
    'IT STILL PULL DOWNWARDS',
    'PULL IS OFF',
    'it says to pull down on the stick',
    'my clip shows the pull is too strong',
  ])('"%s" (pull the verb, or the gun\'s pull) leaves it', (question) => {
    expect(detectRecordedPull(question)).toBeUndefined();
  });

  it('keeps an all-caps free player on Vertical', async () => {
    const { memory, session } = newSession();
    aiTurn(memory, session, 'MY VERTICAL IS 25 AND IT STILL CLIMBS WHEN I PULL THE TRIGGER');
    expect(session.tuning.onRecordedPull).toBeUndefined();
    expect(await turn(memory, session, 'STILL CLIMBING'))
      .toBe('Since 25 is still climbing, try 26 next. Keep Horizontal unchanged so we are testing one variable.');
  });
});

describe('the Workshop named without a pull', () => {
  it.each([
    'my version has no workshop',
    "i can't see the workshop",
    'the workshop isnt there',
    'workshop missing on my zen',
    "I don't have the workshop",
    'I turned the workshop off, my vertical is 25',
    'workshop is off now',
  ])('"%s" clears it', (question) => {
    expect(detectRecordedPull(question)).toBe(false);
  });

  it.each([
    'how do I get the workshop',
    'is the workshop off by default',
  ])('"%s" leaves it', (question) => {
    expect(detectRecordedPull(question)).toBeUndefined();
  });

  it('keeps a player without the Workshop on Vertical', async () => {
    const { memory, session } = newSession();
    aiTurn(memory, session, 'my version has no workshop');
    expect(await turn(memory, session, 'vertical 25 still climbing'))
      .toBe('Since 25 is still climbing, try 26 next. Keep Horizontal unchanged so we are testing one variable.');
  });
});

describe('a slot named without a pull', () => {
  it('keeps the slot but not the flag', () => {
    expect(extractQuestionDetails('picked W2 for my KA-M, how do I record')).toMatchObject({ workshopSlot: 'W2' });
    expect(extractQuestionDetails('picked W2 for my KA-M, how do I record').recordedPull).toBeUndefined();
    expect(detectRecordedPull('W2 PULL')).toBe(true);
    expect(detectRecordedPull('recorded W1 again')).toBe(true);
  });

  it('keeps Vertical for a player who named a slot and then a gun on Vertical', async () => {
    const { memory, session } = newSession();
    aiTurn(memory, session, 'picked W2 for my KA-M, how do I record');
    expect(await turn(memory, session, 'vertical 25 still climbing'))
      .toBe('Since 25 is still climbing, try 26 next. Keep Horizontal unchanged so we are testing one variable.');

    const second = newSession();
    aiTurn(second.memory, second.session, 'I put my M4 in W1');
    expect(await turn(second.memory, second.session, 'for my AKM I use vertical 30 and it is still climbing'))
      .toBe('Since 30 is still climbing, try 31 next. Keep Horizontal unchanged so we are testing one variable.');
    expect(await turn(second.memory, second.session, 'still climbing')).toMatch(/^Since \d+ is still climbing, try \d+ next\./);
    expect(second.session.tuning.onRecordedPull).toBeUndefined();
  });

  it('asks PULL or STD when a player on a pull gives a Vertical value, then follows the answer', async () => {
    const { memory, session } = newSession();
    aiTurn(memory, session, 'home screen shows W1 M4-A1 PULL');
    expect(await turn(memory, session, 'for my AKM I use vertical 30 and it is still climbing')).toBe(PULL_OR_STD_REPLY);
    expect(session.tuning.waitingForTestResult).toBeFalsy();
    aiTurn(memory, session, 'STD');
    expect(session.tuning.onRecordedPull).toBe(false);
    expect(await turn(memory, session, 'still climbing'))
      .toBe('Since 30 is still climbing, try 31 next. Keep Horizontal unchanged so we are testing one variable.');

    const second = newSession();
    aiTurn(second.memory, second.session, 'home screen shows W1 M4-A1 PULL');
    expect(await turn(second.memory, second.session, 'my vertical is 30, still climbing')).toBe(PULL_OR_STD_REPLY);
    aiTurn(second.memory, second.session, 'PULL');
    expect(await turn(second.memory, second.session, 'still climbing')).toBe(UNKNOWN_CLIMB_REPLY);
  });

  it('does not ask when the same message also names the pull, and does not change Scale Y when unsure and stable', () => {
    const state: TuningState = { onRecordedPull: true, scaleY: 105, currentSymptom: 'CLIMBING' };
    expect(recordedPullReply('TEST_RESULT', state, extractQuestionDetails('W1 PULL, my vertical is 25, still climbing'))).toMatch(/^Since Scale Y 105/);
    expect(recordedPullReply('TEST_RESULT', { ...state, currentSymptom: 'STABLE' }, extractQuestionDetails('vertical 30 is stable now')))
      .toBe('Perfect. Keep what you have; it saves when you close the menu.');
  });
});

describe('the Scale Y search remembers both sides', () => {
  async function run(start: string, answers: string[]): Promise<string[]> {
    const { memory, session } = newSession();
    const replies = [await turn(memory, session, start)];
    for (const answer of answers) replies.push(await turn(memory, session, answer));
    return replies;
  }

  it('closes in from both sides: 100 climbs, 105 pulls down, 102 climbs, 104 and 103 pull down', async () => {
    expect(await run('W1 PULL, scale y 100, still climbing', ['now its pulling down', 'still climbing', 'now it pulls down', 'still pulling down'])).toEqual([
      'Since Scale Y 100 is still climbing, raise Scale Y to 105 next (press Up 5 times). Keep Scale X unchanged so we are testing one variable.',
      'You have crossed the balance point. Move Scale Y back toward 100: set Scale Y to 102 (press Down 3 times) and retest.',
      'Since Scale Y 102 is still climbing, raise Scale Y to 104, back toward 105 (press Up 2 times), and retest.',
      'You have crossed the balance point. Move Scale Y back toward 102: set Scale Y to 103 (press Down once) and retest.',
      'The balance point is between Scale Y 102 and 103. Keep whichever feels better; it saves when you close the menu.',
    ]);
  });

  it('never goes past a value that pulled down: 105 climbs, 110 pulls down, 107 and 109 climb', async () => {
    expect(await run('W1 PULL scale y 105 still climbing', ['pulling down now', 'still climbing', 'still climbing'])).toEqual([
      'Since Scale Y 105 is still climbing, raise Scale Y to 110 next (press Up 5 times). Keep Scale X unchanged so we are testing one variable.',
      'You have crossed the balance point. Move Scale Y back toward 105: set Scale Y to 107 (press Down 3 times) and retest.',
      'Since Scale Y 107 is still climbing, raise Scale Y to 109, back toward 110 (press Up 2 times), and retest.',
      'The balance point is between Scale Y 109 and 110. Keep whichever feels better; it saves when you close the menu.',
    ]);
  });

  it('never goes below a value that climbed: 105 climbs, 110 and 107 pull down', async () => {
    const replies = await run('W1 PULL scale y 105 still climbing', ['pulling down now', 'still pulling down']);
    expect(replies[2]).toBe('You have crossed the balance point. Move Scale Y back toward 105: set Scale Y to 106 (press Down once) and retest.');
  });

  it('keeps the range per slot and forgets it when the player says the slot was recorded again', () => {
    const { memory, session } = newSession();
    const say = (question: string) => memory.updateFromQuestion(session, extractQuestionDetails(question), question);
    say('W1 PULL, scale y 100, still climbing');
    memory.record(session, 'x', 'Raise Scale Y to 110 next.');
    say('now it is pulling down');
    expect(session.tuning).toMatchObject({ scaleYClimbs: 100, scaleYPullsDown: 110 });
    say('i redid W1, scale y 110');
    expect(session.tuning.scaleYClimbs).toBeUndefined();
    expect(session.tuning.scaleYPullsDown).toBeUndefined();
    expect(session.tuning.previousScaleY).toBeUndefined();
  });
});

describe('more ways of giving Scale Y', () => {
  const arrow = String.fromCharCode(0x2192);
  const curly = String.fromCharCode(0x2019);
  it.each([
    ['W1 PULL, I raised scale y from 100 to 110 and its still climbing', 110, 100],
    ['scale y was 100 now 105', 105, 100],
    ['scale y 100 -> 105', 105, 100],
    [`scale y 100 ${arrow} 105`, 105, 100],
    ["scale y's at 110", 110, undefined],
    [`scale y${curly}s at 110`, 110, undefined],
    ['scale y went to 110', 110, undefined],
    ['scale y is 105, should i raise it?', 105, undefined],
    ['should i raise scale y to 110? right now scale y is 100', 100, undefined],
    ['scale y is 100.', 100, undefined],
  ])('"%s" reads Scale Y %s (before: %s)', (question, value, previous) => {
    const details = extractQuestionDetails(question);
    expect(details.scaleY).toBe(value);
    expect(details.previousScaleY).toBe(previous);
  });

  it('does not take a value the player only asks about', () => {
    expect(extractQuestionDetails('should i raise scale y to 110?').scaleY).toBeUndefined();
    expect(extractQuestionDetails('what if i set scale y to 120').scaleY).toBeUndefined();
  });

  it('uses the value the player raised it to', async () => {
    const { memory, session } = newSession();
    expect(await turn(memory, session, 'W1 PULL, I raised scale y from 100 to 110 and its still climbing'))
      .toBe('Since Scale Y 110 is still climbing, raise Scale Y to 115 next (press Up 5 times). Keep Scale X unchanged so we are testing one variable.');
    expect(session.tuning).toMatchObject({ scaleY: 115, previousScaleY: 110 });
  });

  it('reads the home screen V on a pull, but not a version number', () => {
    const { memory, session } = newSession();
    const say = (question: string) => memory.updateFromQuestion(session, extractQuestionDetails(question), question);
    say('W1 PULL, the v2 script');
    expect(session.tuning.pullVertical).toBeUndefined();
    say('it shows V28.');
    expect(session.tuning.pullVertical).toBe(28);
  });
});

describe('when Scale Y is not known', () => {
  it('asks for the number and gets shorter, instead of repeating itself', async () => {
    const { memory, session } = newSession();
    expect(await turn(memory, session, 'W1 PULL, still climbing')).toBe(UNKNOWN_CLIMB_REPLY);
    expect(await turn(memory, session, 'ok did it, still climbing'))
      .toBe('Raise Scale Y by another 5 (press Up 5 times), then tell me the Scale Y number it shows.');
    expect(await turn(memory, session, 'now its pulling down'))
      .toBe('You have crossed the balance point. Lower Scale Y by 3 (press Down 3 times), then tell me the Scale Y number it shows.');
    expect(await turn(memory, session, 'still climbing'))
      .toBe('Raise Scale Y by 1 (press Up once), then tell me the Scale Y number it shows.');
    expect(session.tuning.scaleY).toBeUndefined();
    expect(await turn(memory, session, 'scale y is 107 and still climbing'))
      .toBe('Since Scale Y 107 is still climbing, raise Scale Y to 112 next (press Up 5 times). Keep Scale X unchanged so we are testing one variable.');
  });
});

describe('at the ends of Scale Y', () => {
  it('moves Scale Y to 100 for the REDO and starts the search again', async () => {
    const { memory, session } = newSession();
    expect(await turn(memory, session, 'W1 PULL V30 H2 scale y 150 still climbing'))
      .toBe('Scale Y is already at its 150 maximum. Move Scale Y to 100 first, then REDO that slot (Record, 4/7 on the Workshop page), so the new recording has room to go either way.');
    expect(session.tuning).toMatchObject({ scaleY: 100 });
    for (const field of ['previousScaleY', 'scaleYClimbs', 'scaleYPullsDown', 'pullVertical', 'pullHorizontal'] as const) {
      expect(session.tuning[field]).toBeUndefined();
    }
    expect(await turn(memory, session, 'redo done, still climbing'))
      .toBe('Since Scale Y 100 is still climbing, raise Scale Y to 105 next (press Up 5 times). Keep Scale X unchanged so we are testing one variable.');
  });
});

describe('resolved on a pull', () => {
  it('only mentions Scale Y when it was being tuned', async () => {
    const { memory, session } = newSession();
    aiTurn(memory, session, 'W1 PULL, my easing is 20 and aim feels slow');
    expect(await turn(memory, session, 'perfect thanks'))
      .toBe('Perfect. It saves when you close the menu. We can tune Scale X or ADS separately if you need to.');
    expect(recordedPullReply('RESOLVED', { onRecordedPull: true, currentSymptom: 'CLIMBING' }))
      .toBe('Perfect. Keep Scale Y where it is; it saves when you close the menu. We can tune Scale X or ADS separately if you need to.');
  });
});

describe('Weapon OFF in other words', () => {
  it.each([
    'weapon: OFF',
    'weapon is now off',
    "weapon's off",
    `weapon${String.fromCharCode(0x2019)}s off`,
    'set weapon back to off',
    'turned off the weapon slot',
  ])('"%s" clears it', (question) => {
    expect(detectRecordedPull(question)).toBe(false);
  });

  it('is not read as a gun called OFF, and "off target" is not Weapon OFF', () => {
    expect(extractQuestionDetails('weapon: OFF').weapon).toBeUndefined();
    expect(extractQuestionDetails('weapon: M4').weapon).toBe('M4');
    expect(detectRecordedPull('my weapon is way off target')).toBeUndefined();
  });
});

describe('a recording that is a video clip', () => {
  it.each([
    'here is my recording of the spray, vertical 25',
    'I recorded my spray on video',
    'I recorded the gun climbing, clip below',
    'watch my recording, it still climbs',
    'my recording settings are 60fps',
  ])('"%s" leaves it', (question) => {
    expect(detectRecordedPull(question)).toBeUndefined();
  });

  it('keeps a player who posted a clip on Vertical', async () => {
    const { memory, session } = newSession();
    aiTurn(memory, session, 'here is my recording of the spray, vertical 25');
    expect(await turn(memory, session, 'still climbing'))
      .toBe('Since 25 is still climbing, try 26 next. Keep Horizontal unchanged so we are testing one variable.');
  });

  it('still counts a Workshop recording', () => {
    expect(detectRecordedPull('I recorded a new pull')).toBe(true);
    expect(detectRecordedPull('my recording still climbs')).toBe(true);
  });
});

describe('plain test answers', () => {
  const answers: [string, TuningState['currentSymptom']][] = [
    ['it still climbs', 'CLIMBING'],
    ['still climbs a bit', 'CLIMBING'],
    ['ok it still climbs', 'CLIMBING'],
    ['it pulls down', 'PULLING_DOWN'],
    ['it pulls down now', 'PULLING_DOWN'],
    ['feels centered now', 'STABLE'],
    ['it is centered', 'STABLE'],
    ['feels centred', 'STABLE'],
  ];

  it.each(answers)('"%s" is a test result on a pull once a change was suggested', (question, symptom) => {
    const { memory, session } = newSession();
    session.tuning = { onRecordedPull: true, scaleY: 105, waitingForTestResult: true };
    expect(memory.updateFromQuestion(session, extractQuestionDetails(question), question)).toBe('TEST_RESULT');
    expect(session.tuning.currentSymptom).toBe(symptom);
  });

  it.each(answers)('"%s" is read as before off a pull, or before any suggestion', (question) => {
    const before = detectFollowUpIntent(question);
    for (const tuning of [{ vertical: 25, waitingForTestResult: true }, { onRecordedPull: true, scaleY: 105 }] as TuningState[]) {
      const { memory, session } = newSession();
      session.tuning = { ...tuning };
      expect(memory.updateFromQuestion(session, extractQuestionDetails(question), question)).toBe(before);
    }
  });

  it('pins the Vertical path: these answers still go to the AI off a pull', () => {
    for (const [question] of answers) expect(['ACKNOWLEDGEMENT', null]).toContain(detectFollowUpIntent(question));
  });

  it('gives the Scale Y reply for "it pulls down now" after a raise', async () => {
    const { memory, session } = newSession();
    await turn(memory, session, 'W1 PULL, scale y 100, still climbing');
    expect(await turn(memory, session, 'it pulls down now'))
      .toBe('You have crossed the balance point. Move Scale Y back toward 100: set Scale Y to 102 (press Down 3 times) and retest.');
  });

  it('does not take Stable Core for a stable result', () => {
    const { memory, session } = newSession();
    session.tuning = { onRecordedPull: true, scaleY: 105, waitingForTestResult: true };
    expect(memory.updateFromQuestion(session, extractQuestionDetails('is stable core on?'), 'is stable core on?')).toBeNull();
  });
});

// Round 8 added Mag as the Workshop's third item, so Record moved to 4/7 and Scale Y to 5/7.
describe('Workshop item numbers in the recorded-pull replies (seven items)', () => {
  it('sends the player to Scale Y as item 5/7 and to Record as item 4/7, never to a six-item number', () => {
    const replies = [
      recordedPullReply('TEST_RESULT', { onRecordedPull: true, vertical: 25, currentSymptom: 'CLIMBING' }),
      recordedPullReply('TEST_RESULT', { onRecordedPull: true, vertical: 25, currentSymptom: 'PULLING_DOWN' }),
      recordedPullReply('TEST_RESULT', { onRecordedPull: true, scaleY: 150, currentSymptom: 'CLIMBING' }),
      recordedPullReply('TEST_RESULT', { onRecordedPull: true, scaleY: 50, currentSymptom: 'PULLING_DOWN' }),
    ];
    expect(replies[0]).toContain('L1/R1 to Scale Y (5/7)');
    expect(replies[1]).toContain('L1/R1 to Scale Y (5/7)');
    expect(replies[2]).toContain('REDO that slot (Record, 4/7 on the Workshop page)');
    expect(replies[3]).toContain('REDO that slot (Record, 4/7 on the Workshop page)');
    for (const text of replies) expect(text).not.toMatch(/\b[1-7]\/6\b/);
  });

  it('does not read the item number 5/7 as a Scale Y value', () => {
    expect(extractQuestionDetails('scale y (5/7) buzzes').scaleY).toBeUndefined();
    expect(extractQuestionDetails('record (4/7) says ready').scaleY).toBeUndefined();
  });
});
