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
