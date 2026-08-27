import { z } from 'zod';

const envSchema = z.object({
  DISCORD_TOKEN: z.string().min(1),
  DISCORD_CLIENT_ID: z.string().min(1),
  DISCORD_GUILD_ID: z.string().min(1),
  OPENAI_API_KEY: z.string().min(1),
  OWNER_USER_ID: z.string().min(1),
  SUPPORT_CATEGORY_ID: z.string().optional(),
  BUG_REPORT_CHANNEL_ID: z.string().optional(),
  LOG_CHANNEL_ID: z.string().optional(),
  ANNOUNCEMENT_CHANNEL_ID: z.string().optional(),
  DOWNLOAD_CHANNEL_ID: z.string().optional(),
  FAQ_CHANNEL_ID: z.string().optional(),
  DATABASE_URL: z.string().default('file:./data/tcp.db'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
});

export const env = envSchema.parse(process.env);

export type Env = typeof env;
