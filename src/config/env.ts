import { z } from 'zod';

const envSchema = z.object({
  DISCORD_TOKEN: z.string().min(1),
  DISCORD_CLIENT_ID: z.string().min(1),
  DISCORD_GUILD_ID: z.string().min(1),
  OPENAI_API_KEY: z.string().min(1).optional(),
  OWNER_USER_ID: z.string().min(1).optional(),
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

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  const missing = parsedEnv.error.issues
    .filter((issue) => issue.code === 'invalid_type' && issue.received === 'undefined')
    .map((issue) => issue.path.join('.'));
  const invalid = parsedEnv.error.issues
    .filter((issue) => !(issue.code === 'invalid_type' && issue.received === 'undefined'))
    .map((issue) => issue.path.join('.'));

  if (missing.length > 0) {
    console.error(`Missing required environment variables: ${missing.join(', ')}`);
  }
  if (invalid.length > 0) {
    console.error(`Invalid environment variables: ${invalid.join(', ')}`);
  }

  throw new Error('Environment validation failed. Set the variables listed above and restart the application.');
}

export const env = parsedEnv.data;

export type Env = typeof env;
