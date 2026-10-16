import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DocumentParser } from '../src/knowledge/documentParser.js';
import { KeywordRetriever } from '../src/knowledge/retriever.js';
import { extractQuestionDetails } from '../src/ai/question.js';
import { buildRetrievalQuery } from '../src/ai/retrievalQuery.js';

// A member asked "i need help downloading the tcp script" and was sent to the channel they were asking in,
// because the doc still pointed at a download channel that no longer exists.
const chunks = new DocumentParser().parse(readFileSync('knowledge/T.C.P_DOCUMENTATION.md', 'utf8'));
const retriever = new KeywordRetriever(chunks);
const section = chunks.find((chunk) => chunk.heading === 'Downloading the script')?.content ?? '';

describe('downloading the script', () => {
  it.each([
    'i need help downloading the tcp script',
    'how do i download the script',
    'where do i download tcp',
    'where is the download',
    'how do i get the premium file',
    'i paid but did not get the script',
  ])('"%s" finds the download section, as typed and as the bot searches', async (question) => {
    const top = async (query: string) => (await retriever.search(query, 3)).map((result) => result.chunk.heading);
    expect(await top(question)).toContain('Downloading the script');
    expect(await top(buildRetrievalQuery(question, extractQuestionDetails(question)))).toContain('Downloading the script');
  });

  it('points at the DayZ Download button and Premium by DM, never a download channel', () => {
    expect(section).toContain('There is no separate download channel.');
    expect(section).toContain('go to the DayZ channel');
    expect(section).toContain('press **Download**');
    expect(section).toContain('sends the Premium script to your direct messages');
    expect(section).toContain('**Download Premium**');
    const doc = readFileSync('knowledge/T.C.P_DOCUMENTATION.md', 'utf8');
    expect(doc).not.toMatch(/from the download channel/i);
    expect(readFileSync('T.C.P_DOCUMENTATION.md', 'utf8')).toBe(doc);
  });
});
