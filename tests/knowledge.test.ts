import { describe, expect, it } from 'vitest';
import { DocumentParser } from '../src/knowledge/documentParser.js';
import { KeywordRetriever } from '../src/knowledge/retriever.js';

const sample = `# T.C.P. Documentation

## Stable Core Anti-Recoil

Vertical and Horizontal are the authoritative recoil baselines.

### Precision Hold

Precision Hold keeps fire stable after the initial firing window.
`;

describe('knowledge system', () => {
  it('parses markdown into chunked sections', () => {
    const parser = new DocumentParser();
    const chunks = parser.parse(sample);
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0]?.section).toBe('Stable Core Anti-Recoil');
  });

  it('retrieves relevant anti-recoil data for vertical questions', async () => {
    const parser = new DocumentParser();
    const chunks = parser.parse(sample);
    const retriever = new KeywordRetriever(chunks);
    const results = await retriever.search('what does vertical do');
    expect(results[0]?.chunk.section).toBe('Stable Core Anti-Recoil');
  });
});
