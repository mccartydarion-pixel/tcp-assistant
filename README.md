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
- `SETTINGS_CHANNEL_ID` (optional; the channel where members share their T.C.P setups)
- `WELCOME_CHANNEL_ID` (optional; the channel for the Start here panel and new-member greetings)
- `RULES_CHANNEL_ID` (optional; adds a Rules button to the welcome guide)
- `WELCOME_GREET` (optional, default true; `false` keeps the Start here panel but stops per-member greetings)
- `LICENSE_REMINDERS` (optional, default true; `false` stops expiry reminder DMs)
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

## Owner panel: reports and announcements

The owner panel (in `LICENSE_ADMIN_CHANNEL_ID`) has three rows:

- **Members**: pick a member to see their subscription, add days or end access.
- **Reports**: *Active subscriptions* (everyone with days left, soonest expiry first, and how many are on the free trial), *Expiring this week* (7 days or less), and *Recent codes* (the latest 20 codes generated). Replies are private to the owner.
- **Announce**: *Post announcement* or *Post announcement + flyer* opens a form (title, version, patch notes, link). The bot shows a private preview first; nothing is posted until **Post** or **Post + @everyone** is pressed. It posts to `ANNOUNCEMENT_CHANNEL_ID`. The flyer is `assets/tcp-flyer.gif`; replace that file to change it. The bot needs Send Messages, Embed Links and Attach Files there, and Mention Everyone to use the @everyone button.

## Settings sharing

With `SETTINGS_CHANNEL_ID` set, the bot posts a **Share my settings** panel in that channel. Pressing it starts a short private wizard:

1. Pick a playstyle and a weapon from two dropdowns.
2. Fill in the anti-recoil form: setup name, Vertical, Horizontal, Turn Strength and the DayZ in-game aiming sensitivity (required, because values only carry over between players with similar in-game sensitivity).
3. Optionally fill in the ADS form: ADS Sens, Precision, Easing, Fire Sens and notes.
4. Check the preview, edit any part, then post.

Every value is checked against the range the script accepts (`SETTING_FIELDS` in `src/settings/settingsPanel.ts`); a mistake reopens the form with what was typed. The posted card shows the values in rows of three under ANTI-RECOIL and ADS ACCURACY headings, with the playstyle and weapon as tags. Its **How to apply** button tells anyone which menu page each value goes on; the page numbers in `SETTING_FIELDS` must match the script's menu. Each member can share once every 10 minutes, and a form left unfinished expires after 20 minutes. The bot moves its panel back to the bottom of the channel after each post. It needs View Channel, Send Messages, Embed Links and Read Message History there.

## My licence and expiry reminders

The licence panel has a **My licence** button next to Generate. It shows the member, privately, their days left, end date, the power-ups a code would last now, codes generated today and their last code.

Once an hour the bot checks subscriptions and DMs each member whose trial or subscription ends within three days, and again in its last day (`src/license/reminders.ts`). Each reminder is recorded against the end date it was about (`license_reminders` table), so it is sent once, and adding days starts a fresh pair. The owner gets none. Members with DMs closed cannot be reached; that is logged and not retried.

## Bug reports

With `BUG_REPORT_CHANNEL_ID` set, the bot posts a **Report a bug** panel there. A member picks the feature and build, fills in a summary, what happened, what was expected, steps to reproduce and (optionally) version and settings, previews it and submits. The card is posted in that channel with status buttons (Investigating, Fixed, Can't reproduce, Reopen) that only the owner can use; the reporter gets a DM when the status changes. One report per member every five minutes.

## Welcome

With `WELCOME_CHANNEL_ID` set, the bot posts a **Start here** panel with buttons for private guides (Get my licence, Download, Settings, Get help, Rules; each only when its channel is set). It also greets each new member in that channel with the same buttons. New members are noticed from Discord's own "joined the server" message, so the server's **System Messages Channel** must have *Send a random welcome message when someone joins* switched on (Server Settings → Overview). No privileged gateway intent is needed.

## Unanswered questions

When the documentation does not cover a question, the AI ends its reply with a marker the bot removes before replying (`src/ai/unansweredMarker.ts`). The bot then posts the question, who asked, where, and the closest documentation sections to `LOG_CHANNEL_ID`, at most once a day per question. Questions with no documentation match at all are logged too. Use these to decide what to add to the knowledge file.

## Knowledge file setup

The project uses the documentation file at:

`knowledge/T.C.P_DOCUMENTATION.md`

This file is the authoritative technical source for the bot. It is written for players: features, every menu page with its range and default, controls, tuning, troubleshooting and the licence. Keep it in step with the script when the script changes, and keep the root `T.C.P_DOCUMENTATION.md` copy identical. `tests/knowledge-doc.test.ts` checks that common player questions reach the right section.

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
