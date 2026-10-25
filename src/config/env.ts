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
  // The four info channels (FAQ, Rules, Disclaimer, Overview) the bot keeps its own post in; each has a
  // default in src/info/infoChannels.ts and these move it.
  FAQ_CHANNEL_ID: z.string().optional(),
  INFO_OVERVIEW_CHANNEL_ID: z.string().optional(),
  INFO_FAQ_CHANNEL_ID: z.string().optional(),
  INFO_DISCLAIMER_CHANNEL_ID: z.string().optional(),
  INFO_RULES_CHANNEL_ID: z.string().optional(),
  LICENSE_CHANNEL_ID: z.string().optional(),
  LICENSE_SECRET: z.string().optional(),
  LICENSE_ADMIN_CHANNEL_ID: z.string().optional(),
  SETTINGS_CHANNEL_ID: z.string().optional(),
  WELCOME_CHANNEL_ID: z.string().optional(),
  RULES_CHANNEL_ID: z.string().optional(),
  REVIEW_CHANNEL_ID: z.string().optional(),
  REVIEW_VOICE_CHANNEL_ID: z.string().optional(),
  // The channel where the assistant answers every message, no @mention needed.
  HELP_CHANNEL_ID: z.string().optional(),
  // Ticket transcripts go here; LOG_CHANNEL_ID when unset. The Open a ticket panel goes in
  // TICKET_PANEL_CHANNEL_ID, or the help channel when unset. Tickets are created in SUPPORT_CATEGORY_ID.
  TICKET_LOG_CHANNEL_ID: z.string().optional(),
  TICKET_PANEL_CHANNEL_ID: z.string().optional(),
  // Roles given by the Get started setup; found or created by name when unset.
  PLAYSTATION_ROLE_ID: z.string().optional(),
  XBOX_ROLE_ID: z.string().optional(),
  // Stripe payments for T.C.P Premium. The secret key (sk_live_ or sk_test_), the recurring price members
  // subscribe to (price_...), and the signing secret of the webhook endpoint (whsec_...).
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_PRICE_ID: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  // Optional yearly price of the same product (price_...); adds a Yearly button next to Subscribe.
  STRIPE_YEARLY_PRICE_ID: z.string().optional(),
  // Paying members get this role and are welcomed in this channel. When unset, the bot uses a role named
  // "Elite Supporter" and a text channel with "elite" and "welcome" in its name.
  ELITE_ROLE_ID: z.string().optional(),
  ELITE_WELCOME_CHANNEL_ID: z.string().optional(),
  // The Elite Supporters' own panel (their plan, renew, change plan, download, codes). When unset, the bot uses a
  // text channel with "elite" and "hub" in its name, and creates "💎・elite-hub" (Elite role only) if there is none.
  ELITE_HUB_CHANNEL_ID: z.string().optional(),
  // 'false' turns the feature off; anything else (or unset) leaves it on.
  LICENSE_REMINDERS: z.string().default('true'),
  WELCOME_GREET: z.string().default('true'),
  WELCOME_MEMBER_INTENT: z.string().default('true'),
  LICENSE_MEMBER_ROLE_ID: z.string().optional(),
  LICENSE_TRIAL_DAYS: z.coerce.number().int().min(1).max(3650).default(14),
  // New numbers each member may get a code for per day. One Zen rarely needs more than one.
  LICENSE_MAX_CODES: z.coerce.number().int().min(1).default(1),
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
