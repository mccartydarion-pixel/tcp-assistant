import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger } from '../utils/logger.js';

export class DocumentLoader {
  constructor(
    private readonly documentPath = resolve(
      dirname(fileURLToPath(import.meta.url)),
      '..',
      '..',
      'knowledge',
      'T.C.P_DOCUMENTATION.md',
    ),
  ) {}

  async load(): Promise<string> {
    try {
      const text = await readFile(this.documentPath, 'utf8');
      logger.info('[TCP Knowledge] Loaded T.C.P_DOCUMENTATION.md');
      return text;
    } catch (error) {
      logger.error({ err: error }, '[TCP Knowledge ERROR] T.C.P_DOCUMENTATION.md could not be loaded.');
      throw new Error(`Unable to load T.C.P documentation: ${this.documentPath}`);
    }
  }
}
