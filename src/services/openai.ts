import OpenAI from 'openai';
import { env } from '../config/env.js';

export const openai = env.OPENAI_API_KEY ? new OpenAI({ apiKey: env.OPENAI_API_KEY }) : null;

export function isOpenAiConfigured(): boolean {
  return openai !== null;
}
