import type { KnowledgeChunk } from './types.js';

const normalizeHeading = (heading: string): string => heading.replace(/^\d+\.?\s*/, '').trim();

export class DocumentParser {
  parse(documentText: string, source = 'T.C.P_DOCUMENTATION.md'): KnowledgeChunk[] {
    const lines = documentText.split(/\r?\n/);
    const chunks: KnowledgeChunk[] = [];

    let currentSection = 'Overview';
    let currentSubsection = '';
    let currentHeading = 'Overview';
    let currentContent: string[] = [];

    const flush = () => {
      if (currentContent.length === 0) return;
      const content = currentContent.join('\n').trim();
      if (!content) return;

      chunks.push({
        id: `${currentSection}-${currentSubsection || currentHeading}`.replace(/\s+/g, '-').toLowerCase(),
        section: currentSection,
        subsection: currentSubsection || undefined,
        heading: currentHeading,
        content,
        source,
        keywords: extractKeywords(currentHeading, content),
      });

      currentContent = [];
    };

    for (const line of lines) {
      const headingMatch = line.match(/^(##+)\s+(.*)$/);
      if (headingMatch) {
        flush();
        const level = headingMatch[1].length;
        const headingTitle = normalizeHeading(headingMatch[2]);
        currentHeading = headingTitle;

        if (level === 2) {
          currentSection = headingTitle;
          currentSubsection = '';
        } else {
          currentSubsection = headingTitle;
        }
        continue;
      }

      if (line.startsWith('#')) continue;
      currentContent.push(line);
    }

    flush();
    return chunks;
  }
}

function extractKeywords(heading: string, content: string): string[] {
  const text = `${heading} ${content}`.toLowerCase();
  const tokens = text.match(/[a-z0-9]+/g) ?? [];
  const seen = new Set<string>();

  return tokens.filter((token) => {
    if (token.length <= 2) return false;
    if (seen.has(token)) return false;
    seen.add(token);
    return true;
  }).slice(0, 40);
}
