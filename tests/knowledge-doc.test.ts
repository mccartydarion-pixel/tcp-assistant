import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DocumentParser } from '../src/knowledge/documentParser.js';
import { KeywordRetriever } from '../src/knowledge/retriever.js';
import { KnowledgeService } from '../src/knowledge/knowledgeService.js';

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
  ])('"%s" finds %s', async (question, heading) => {
    expect(await topHeading(question)).toBe(heading);
  });

  it('documents the current 26-page menu, not the old 12-page one', () => {
    const text = readFileSync('knowledge/T.C.P_DOCUMENTATION.md', 'utf8');
    expect(text).toContain('26 pages');
    expect(text).not.toMatch(/12[- ]page/i);
  });
});

describe('canned answers', () => {
  it('does not tell players ADS profiles are a legacy setting', async () => {
    const answer = await new KnowledgeService().buildAnswer('how do I switch my ads profile');
    expect(answer.content).not.toMatch(/legacy|not part of the active/i);
  });

  it('still explains that recoil patterns do not exist', async () => {
    const answer = await new KnowledgeService().buildAnswer('where is the recoil pattern setting');
    expect(answer.content).toMatch(/no recoil phases, patterns or weapon profiles/i);
  });
});
