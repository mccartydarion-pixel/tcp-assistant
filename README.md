# T.C.P. Assistant

T.C.P. Assistant is a production-ready Discord support bot for the Tactical Competitive Pro community. It uses the authoritative knowledge in `knowledge/T.C.P_DOCUMENTATION.md` to answer technical questions, help with tuning, manage support tickets, and escalate unresolved issues.

## Overview

- Discord support assistant
- Documentation-grounded technical answers
- Recoil and ADS tuning guidance
- Ticket creation and summary generation
- Bug report handling
- Owner escalation workflows
- SQLite-first local database
- PostgreSQL-ready schema design

## Requirements

- Node.js 22 LTS
- npm
- Discord application token
- OpenAI API key
- Optional channel IDs for ticket, support, announcements, and logs

## Installation

1. Install dependencies:
   ```bash
   npm install
   ```
2. Copy `.env.example` to `.env` and fill in the required values.
3. Place the documentation at `knowledge/T.C.P_DOCUMENTATION.md`.
4. Run the bot:
   ```bash
   npm run dev
   ```

## Environment variables

- `DISCORD_TOKEN`
- `DISCORD_CLIENT_ID`
- `DISCORD_GUILD_ID`
- `OPENAI_API_KEY`
- `OWNER_USER_ID`
- `SUPPORT_CATEGORY_ID` (optional)
- `BUG_REPORT_CHANNEL_ID` (optional)
- `LOG_CHANNEL_ID` (optional)
- `ANNOUNCEMENT_CHANNEL_ID` (optional)
- `DOWNLOAD_CHANNEL_ID` (optional)
- `FAQ_CHANNEL_ID` (optional)
- `LICENSE_CHANNEL_ID` (optional; the channel that holds the licence generator panel)
- `LICENSE_SECRET` (needed for the generator; six comma-separated numbers that must match the key built into the script)
- `LICENSE_ADMIN_CHANNEL_ID` (optional; a private channel for the owner's licence panel)
- `LICENSE_MEMBER_ROLE_ID` (optional; the role given to a member when they generate a code)
- `LICENSE_TRIAL_DAYS` (optional, default 14; length of the free trial granted on first generate)
- `LICENSE_MAX_CODES` (optional, default 3; new codes each member may generate per day)
- `DATABASE_URL` (optional, default SQLite file)
- `NODE_ENV`
- `PORT`

## Discord setup

1. Create a bot in the Discord Developer Portal.
2. Enable the following gateway intents:
   - `Guilds`
   - `GuildMessages`
   - `MessageContent`
3. Add the bot to the target server with application commands permissions.
4. Invite the bot with `applications.commands` and `bot` scopes.

## Licence generator

The T.C.P. script shows a five-digit number on the Zen. A member brings it here and gets back the six-digit code that unlocks the script. Codes run out, so members return for a new one, and the bot only gives one while their subscription is active.

**Member panel.** With `LICENSE_CHANNEL_ID` and `LICENSE_SECRET` set, the bot posts a panel with a **Generate** button in that channel on startup, and refreshes its own panel if one is already there. The button opens a form for the number, and the code comes back in a reply only that member can see.

**Free trial and role.** The first time a member presses **Generate** with no active subscription, the bot gives them a free trial of `LICENSE_TRIAL_DAYS` days (default 14) automatically, once. Whenever a member successfully gets a code, the bot also gives them the role in `LICENSE_MEMBER_ROLE_ID` (if set). The trial is once per member — generating again after it ends does not renew it; that needs the owner panel or a paid subscription. For the role, the bot needs the **Manage Roles** permission and its own role must sit above the member role.

**Owner panel.** With `LICENSE_ADMIN_CHANNEL_ID` and `OWNER_USER_ID` set, the bot posts a second panel in that channel. Keep the channel private. Pick a member from the menu to see their subscription, then **Add days** or **End access**. Nobody can generate a code until they have been given days. The owner can always generate.

**How long a code lasts.** The code carries a tier chosen from the days left on the subscription, and the script counts power-ups against it:

| Days left | Power-ups |
|---|---|
| 63 or more | 400 |
| 34 to 62 | 200 |
| 16 to 33 | 80 |
| 8 to 15 | 50 |
| 1 to 7 | 20 |

When the power-ups are used up, the script shows a new number. Ending a member's access stops new codes; a code already on their Zen runs until its power-ups are gone.

- The arithmetic lives in `src/license/licenseCode.ts` and is mirrored in the script. Change one and the other must change too.
- `LICENSE_MAX_CODES` is how many new numbers a member may get codes for in a day. Asking again for the same number does not count.
- Subscriptions and issued codes are stored in Postgres when `DATABASE_URL` starts with `postgres://` or `postgresql://`. Otherwise they go in the local SQLite file `data/tcp.db`, which a redeploy clears.
- The bot needs View Channel, Send Messages, Embed Links and Read Message History in both channels.

## Knowledge file setup

The project uses the documentation file at:

`knowledge/T.C.P_DOCUMENTATION.md`

This file is the authoritative technical source for the bot.

## Running locally

```bash
npm run build
npm start
```

## Testing

```bash
npm test
```

## Railway deployment

Railway uses Railpack with the following build/start flow:

```bash
npm run build
npm start
```

## Owner commands

These commands require owner/admin permissions and should be restricted in Discord:

- `/tcp reload-docs`
- `/tcp status`
- `/tcp summarize`
- `/tcp escalate`
- `/tcp resolve`

## Troubleshooting

- If the knowledge document is missing, the bot will serve a safe fallback response instead of guessing.
- If OpenAI is unavailable, the bot still supports documentation FAQ responses, ticket collection, and command actions.
- If the database fails, the bot should continue in degraded mode without crashing.

## Notes

This project is intentionally a Discord support-only assistant and does not modify the Cronus Zen GPC source or game script.
