import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DocumentParser } from '../src/knowledge/documentParser.js';
import { KeywordRetriever } from '../src/knowledge/retriever.js';
import { KnowledgeService } from '../src/knowledge/knowledgeService.js';
import { buildTCPPrompt } from '../src/ai/promptBuilder.js';
import { systemPrompt } from '../src/ai/systemPrompt.js';
import { extractQuestionDetails } from '../src/ai/question.js';
import { buildRetrievalQuery } from '../src/ai/retrievalQuery.js';

// The Weapon Workshop is a T.C.P Premium feature (the licensed script from the Discord, not the free
// marketplace version): four weapon slots, each holding one steady pull the player records on the Zen.
// These pin which part of the doc a player's question reaches, as typed and as the bot searches (the bot
// adds topic words such as "anti_recoil" for any question that mentions a gun), and that the doc, the
// system prompt and the canned answer all say it is Premium only.
const doc = readFileSync('knowledge/T.C.P_DOCUMENTATION.md', 'utf8');
const chunks = new DocumentParser().parse(doc);
const retriever = new KeywordRetriever(chunks);
const content = (heading: string) => chunks.find((chunk) => chunk.heading === heading)?.content ?? '';

const WHAT = 'What the Weapon Workshop is and who has it';
const RECORD = 'Workshop: recording step by step';
const SLOTS = 'Workshop: switching slots and using a recording';
const SCALE = 'Workshop: Scale Y and Scale X';
const REDO = 'Workshop: redo, clear and the four slots';
const MESSAGES = 'Workshop messages';
const BUZZES = 'Workshop buzzes';
const NOTES = 'Workshop: notes on recording';

async function top(query: string, limit = 1): Promise<string[]> {
  return (await retriever.search(query, limit)).map((result) => result.chunk.heading);
}

function botQuery(question: string): string {
  return buildRetrievalQuery(question, extractQuestionDetails(question));
}

describe('Weapon Workshop doc', () => {
  it('has its own section with one subsection per kind of question', () => {
    const workshop = chunks.filter((chunk) => chunk.section === 'Weapon Workshop (Premium)').map((chunk) => chunk.heading);
    expect(workshop).toEqual([WHAT, RECORD, SLOTS, SCALE, REDO, MESSAGES, BUZZES, NOTES]);
  });

  it('says the Workshop is Premium only, wherever the versions are described', () => {
    expect(content(WHAT)).toContain('The Weapon Workshop is part of **T.C.P Premium**, the licensed script from the T.C.P Discord. It is not in the free marketplace version.');
    expect(content(WHAT)).toContain('check that you loaded the licensed script from the Discord, not the marketplace one');
    expect(content('Versions')).toContain('It has every feature except the Weapon Workshop, and no lock.');
    expect(content('Versions')).toContain('It has everything in the free version plus the Weapon Workshop');
    expect(content('Menu Pages')).toContain('T.C.P Premium adds a 27th page, **Workshop** (six items: Weapon, Gun, Record, Scale Y, Scale X, Clear), after Motion Intel. The menu opens on Master, so LEFT once from there goes straight to it.');
    expect(doc).toContain("26-page menu on the Zen's OLED screen (27 pages in T.C.P Premium)");
  });

  it('no longer says there are no weapon profiles, and says what each version uses', () => {
    expect(doc).not.toMatch(/no weapon profiles/i);
    expect(content('Vertical and Horizontal Recoil')).toContain('There are no recoil patterns or phase settings. The free version uses one Vertical/Horizontal pair for every gun; T.C.P Premium can also store a recorded pull for each gun in the Weapon Workshop');
    expect(content('Limits')).toContain('There are no recoil patterns or phases. The free version uses one Vertical/Horizontal pair for every gun');
  });

  it('walks through a recording with PlayStation and Xbox buttons', () => {
    const steps = content(RECORD);
    expect(steps).toContain('Master and Anti-Recoil on');
    expect(steps).toContain('L2 + OPTIONS (LT + Menu), then LEFT once. The page shows 27/27. L1/R1 (LB/RB) moves between its six items.');
    expect(steps).toContain('**Record** (3/6): press X (A). Two short buzzes mean it is ARMED. Close the menu with Circle (B).');
    expect(steps).toContain('aim with L2 (LT) first, then hold R2 (RT)');
    expect(steps).toContain('Three long buzzes mean COMPLETE: the pull is saved.');
  });

  it('covers scales, clearing, the slots and factory reset', () => {
    expect(content(SCALE)).toContain('Scale Y and Scale X (50 to 150%, default 100)');
    expect(content(SCALE)).toContain('those are locked while a slot with a pull is selected');
    expect(content(REDO)).toContain('hold X (A) for one second until the bar fills. Four short buzzes mean it is cleared');
    expect(content(REDO)).toContain('A factory reset (L1 + R1 + X in the menu) keeps your recordings');
    expect(content('Factory reset')).toContain('your Weapon Workshop recordings are kept too');
    expect(content(SLOTS)).toContain('a **PULL** badge');
    expect(content('Calibrate Recoil')).toContain('PULL IN USE');
  });

  // Card words still being finalised (REDO ONCE, VERTICAL UP, the VSS magazine hint) are left out of this list.
  it('explains every recorder card message and every buzz', () => {
    for (const message of ['TOO SHORT / FULL MAG', 'TOO SHORT / HOLD LONGER', 'STICK MOVED / FIRE AGAIN', 'OFF PATTERN', 'AIM FIRST', 'AIM LOST', 'CANCELLED', 'STOPPED / NOT SAVED', 'PULL: SCALE Y', 'RECORD FIRST', 'NOTHING TO CLEAR']) {
      expect(content(MESSAGES)).toContain(`**${message}`);
    }
    for (const buzz of ['**2 short**: recorder armed.', '**3 short**: spray counted.', '**3 long**: session complete, pull saved.', '**2 long**: session stopped, nothing saved.', '**4 short**: slot cleared.', '**1 long**: spray thrown out', '**1 short**: during a spray']) {
      expect(content(BUZZES)).toContain(buzz);
    }
  });

  it('names the card states and the page words a player can see', () => {
    const messages = content(MESSAGES);
    expect(messages).toContain("**The card's big label** says what the recorder is doing");
    for (const word of ['**ARMED**', '**REC**', '**ACCEPTED**', '**DISCARDED**', '**COMPLETE**', '**STOPPED**', 'AIM AT MARK', 'REPLACES', 'FIRE A MAG', 'KEEP AIMING', 'UNTIL EMPTY', 'DROP+LEAN', 'READY', 'STD V/H', 'EMPTY']) {
      expect(messages).toContain(word);
    }
  });

  it('describes CANCELLED, AIM LOST and STOPPED as the script behaves', () => {
    const messages = content(MESSAGES);
    expect(messages).toContain('**AIM LOST**: you let go of L2 (LT) early in the spray (within its first second) while still holding R2 (RT).');
    expect(messages).toContain('It does not buzz and does not count toward stopping the session.');
    expect(messages).toContain('three thrown out for any reason except CANCELLED');
    expect(content(BUZZES)).toContain('and CANCELLED never does');
  });

  // The L3 + R3 hold is ignored while the menu is open, and MASTER IS OFF is shown on the Record item.
  it('fixes MASTER IS OFF from inside the menu', () => {
    expect(content(MESSAGES)).toContain('**MASTER IS OFF** (Record): Master is off. Press RIGHT once to go to the Master page (it wraps round from the Workshop), press X (A) to turn it on');
    expect(content(MESSAGES)).toContain('the hold does nothing while the menu is open');
    expect(content('Master on and off')).toContain('The hold only works with the menu closed; with the menu open, switch Master on its own page');
  });

  it('lists the guns the Gun item offers', () => {
    expect(content(RECORD)).toContain('The gun list: M4-A1, M16-A2, KA-M, KA-74, KAS-74U, KA-101, LAR, AUR AX, VIKHR, SVAL, VSS, BIZON, SG5-K, USG-45, LE-MAS, and OTHER for a gun that is not listed.');
    expect(content(RECORD)).toContain('W1 M4-A1, W2 KA-M, W3 LAR and W4 VIKHR');
  });

  it('tells Premium players what to change instead of Vertical and Horizontal', () => {
    expect(content('Gun drifts left or right')).toContain('Horizontal Recoil is locked: adjust Scale X instead');
    expect(content('Hip Fire Recoil')).toContain('or of the recorded pull, when a Weapon Workshop slot with one is selected');
    expect(content('Anti Deadzone')).toContain('for a recorded Weapon Workshop slot, Scale Y and Scale X, or a REDO');
    expect(content(WHAT)).toContain('licensed downloads from before the Workshop do not have it');
  });
});

describe('Weapon Workshop retrieval', () => {
  it.each([
    ['how do i record a gun', RECORD],
    ['how do i record my m4', RECORD],
    ['what is the weapon workshop', WHAT],
    ['what is the workshop', WHAT],
    ['is the workshop free', WHAT],
    ['is the workshop on the free version', WHAT],
    ['where is the workshop page', WHAT],
    ['can i use the workshop on xbox', WHAT],
    ['are there weapon profiles', WHAT],
    ['it says stick moved', MESSAGES],
    ['what does off pattern mean', MESSAGES],
    ['too short hold longer', MESSAGES],
    ['it says too short', MESSAGES],
    ['what does aim first mean', MESSAGES],
    ['aim lost', MESSAGES],
    ['it says vertical up', MESSAGES],
    ['my recording wont save', MESSAGES],
    ['recording keeps stopping', MESSAGES],
    ['what does cancelled mean', MESSAGES],
    ['how do i clear a slot', REDO],
    ['REDO ONCE?', REDO],
    ['how do i redo a gun', REDO],
    ['can i put the same gun in two slots', REDO],
    ['how many slots are there', REDO],
    ['do my recordings survive power off', REDO],
    ['what is scale y', SCALE],
    ['what is scale x', SCALE],
    ['vertical recoil is locked', SCALE],
    ['why cant i change vertical recoil', SCALE],
    ['how do i switch guns', SLOTS],
    ['what does the pull badge mean', SLOTS],
    ['what does weapon off do', SLOTS],
    ['what do the buzzes mean when recording', BUZZES],
    ['what does 3 long buzzes mean', BUZZES],
    ['does drop on fire work while recording', NOTES],
    ['lean spam stopped while recording', NOTES],
    ['what happens if i open the menu while recording', NOTES],
    // Indirect phrasings that mention a gun, recoil or vertical: the bot adds "anti_recoil" to these, which
    // used to bury every Workshop chunk under the Anti-Recoil section.
    ['how do i set recoil per gun', RECORD],
    ['can i save a different recoil for my m4 and my akm', RECORD],
    ['can i save settings for each gun', RECORD],
    ['different vertical for each gun', RECORD],
    ['is there a pattern for each gun', RECORD],
    ['which guns can i pick in the gun list', RECORD],
    ["my gun isn't on the list", RECORD],
    ['how do i switch between guns', SLOTS],
    ['when changing guns do i need to change slot', SLOTS],
    ['how do i go back to normal vertical', SLOTS],
    ['what does STD mean on the home screen', SLOTS],
    ['how many guns can i save', REDO],
    ['how do i delete a recording', REDO],
    ['how do i reset a slot', REDO],
    ['the vertical number wont go up it just buzzes', SCALE],
    ['vertical recoil wont change', SCALE],
    ['why is my vertical stuck', SCALE],
    ['horizontal wont change', SCALE],
    ['my gun still climbs with the recorded pull', SCALE],
    ['what does discarded mean', MESSAGES],
    ['what does REPLACES mean', MESSAGES],
    ['what does AIM AT MARK mean', MESSAGES],
    ['it says master is off', MESSAGES],
    ['the card says drop+lean', MESSAGES],
  ])('"%s" finds %s, as typed and as the bot searches', async (question, heading) => {
    expect(await top(question)).toEqual([heading]);
    expect(await top(botQuery(question))).toEqual([heading]);
  });

  // The Factory reset section answers this one itself; the Workshop's own line comes right after it.
  it('answers "does factory reset delete my recordings" with the sections that say they are kept', async () => {
    for (const query of ['does factory reset delete my recordings', botQuery('does factory reset delete my recordings')]) {
      expect(await top(query, 2)).toEqual(['Factory reset', REDO]);
    }
  });

  it('puts the recording steps in the prompt for a recording question', async () => {
    const question = 'how do i record a gun';
    const details = extractQuestionDetails(question);
    const prompt = buildTCPPrompt({ question, details, retrievedChunks: await retriever.search(buildRetrievalQuery(question, details), 5) });
    expect(prompt.context).toContain(`[Weapon Workshop (Premium) > ${RECORD}]\n${content(RECORD)}`);
  });

  it('puts the recording steps in the prompt for "how do i set recoil per gun"', async () => {
    const question = 'how do i set recoil per gun';
    const details = extractQuestionDetails(question);
    expect(details.topic).toBe('anti_recoil');
    const prompt = buildTCPPrompt({ question, details, retrievedChunks: await retriever.search(buildRetrievalQuery(question, details), 5) });
    expect(prompt.context).toContain(`[Weapon Workshop (Premium) > ${RECORD}]\n${content(RECORD)}`);
  });
});

// Every Workshop chunk shares the section name "Weapon Workshop (Premium)" and matching is by substring, so
// "work", "weapon", "premium", "use", "lot" and the like could pull everyday questions into it.
describe('Workshop aliases leave other questions alone', () => {
  it.each([
    ['what does vertical do', 'Vertical and Horizontal Recoil'],
    ['how do i unlock the script', 'How to unlock'],
    ['my script is locked', 'How to unlock'],
    ['my code does not work', 'Problems getting a code'],
    ['my code is not working', 'Problems getting a code'],
    ['my trial ended', 'Free trial'],
    ['how much is premium', 'Versions'],
    ['how do i get premium', 'Versions'],
    ['drop shot doesnt work', 'Drop Shot and Crouch Shot'],
    ['drop on fire not working', 'Drop Shot and Crouch Shot'],
    ['crouch shot', 'Drop Shot and Crouch Shot'],
    ['lean spam not working', 'Lean Spam'],
    ['does it work on xbox', 'Xbox controllers'],
    ['my weapon keeps climbing', 'Gun climbs during a burst'],
    ['gun keeps climbing', 'Gun climbs during a burst'],
    ['my weapon drifts right', 'Gun drifts left or right'],
    ['how do i calibrate', 'Calibrate Recoil'],
    ['how do i redo calibration', 'Calibrate Recoil'],
    ['how do i switch profile', 'ADS Profiles'],
    ['how do i factory reset', 'Factory reset'],
    ['clear all settings', 'Factory reset'],
    ['how do i use precision', 'Precision'],
    ['what does turn strength do', 'Turn Strength'],
    ['my moonwalk keeps stopping', 'Auto Movement (moonwalk)'],
  ])('"%s" still finds %s', async (question, heading) => {
    expect(await top(question)).toEqual([heading]);
  });

  // Broader versions of the per-gun and locked-Vertical aliases would catch these.
  it.each([
    'how do i change horizontal',
    'what is a good recoil for my m4',
    "vertical won't save",
    'change gun sensitivity',
    'why does my gun have different recoil every spray',
    'what is a normal vertical value',
  ])('"%s" does not go to the Workshop, as typed or as the bot searches', async (question) => {
    for (const query of [question, botQuery(question)]) {
      const [first] = await retriever.search(query, 1);
      expect(first?.chunk.section).not.toBe('Weapon Workshop (Premium)');
    }
  });

  it('keeps "weapon sway" with the limits of the script, not the Weapon Workshop', async () => {
    const headings = await top('does tcp remove weapon sway', 2);
    expect(headings).toEqual(['Overview', 'Limits']);
  });
});

describe('Workshop in the prompt and canned answers', () => {
  it('tells the assistant the Workshop is Premium only and to check the member has Premium', () => {
    expect(systemPrompt).toContain('There are no recoil patterns or phase settings.');
    expect(systemPrompt).toContain('The Weapon Workshop is T.C.P Premium only (the licensed script from the Discord), not in the free marketplace version');
    expect(systemPrompt).toContain('If a member asks about it or cannot find it, check they have Premium.');
    expect(systemPrompt).not.toMatch(/no weapon profiles/i);
  });

  it('tells the assistant that Vertical, Horizontal and Calibrate are locked while a recorded pull is selected', () => {
    expect(systemPrompt).toContain('While a Workshop slot with a recorded pull is selected (the home screen shows the slot and a PULL badge), Vertical Recoil, Horizontal Recoil and Calibrate Recoil are locked');
    expect(systemPrompt).toContain('tune that gun with Scale Y and Scale X on the Workshop page, the last menu page (27/27, LEFT once from Master), or set Weapon OFF');
  });

  it('no longer denies weapon profiles, and points to the Workshop in Premium', async () => {
    const answer = await new KnowledgeService().buildAnswer('are there weapon profiles');
    expect(answer.content).not.toMatch(/no recoil phases, patterns or weapon profiles|no weapon profiles/i);
    expect(answer.content).toContain('T.C.P Premium also has the Weapon Workshop');
    expect(answer.content).toContain('The free version uses one Vertical and Horizontal for every gun.');
  });
});
