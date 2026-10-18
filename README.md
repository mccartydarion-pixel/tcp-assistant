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
- `DOWNLOAD_CHANNEL_ID` (optional; only used when no games are listed in `src/games/gameScripts.ts`)
- `INFO_OVERVIEW_CHANNEL_ID`, `INFO_FAQ_CHANNEL_ID`, `INFO_DISCLAIMER_CHANNEL_ID`, `INFO_RULES_CHANNEL_ID` (optional; the four info channels the bot keeps its own post in, see Info channels below; each defaults to the server's own channel, so set one only to move it)
- `LICENSE_CHANNEL_ID` (optional; the channel that holds the licence generator panel)
- `LICENSE_SECRET` (needed for the generator; six comma-separated numbers that must match the key built into the script)
- `LICENSE_ADMIN_CHANNEL_ID` (optional; a private channel for the owner's licence panel)
- `LICENSE_MEMBER_ROLE_ID` (optional; the role given to a member when they generate a code)
- `SETTINGS_CHANNEL_ID` (optional; the channel where members share their T.C.P setups)
- `WELCOME_CHANNEL_ID` (optional; the channel for the Start here panel and new-member greetings)
- `RULES_CHANNEL_ID` also adds a Rules button to the welcome guide (only when it is set)
- `REVIEW_CHANNEL_ID` (optional; the channel for the review panel and posted reviews)
- `REVIEW_VOICE_CHANNEL_ID` (optional; a voice channel the bot renames to show the star rating)
- `HELP_CHANNEL_ID` (optional; the channel where the assistant answers every question, no @mention needed)
- `TICKET_LOG_CHANNEL_ID` (optional; private channel for ticket opened/closed logs and transcripts; `LOG_CHANNEL_ID` when unset)
- `TICKET_PANEL_CHANNEL_ID` (optional; where the Open a ticket panel goes; without it the ticket buttons are on the help channel panel)
- `PLAYSTATION_ROLE_ID`, `XBOX_ROLE_ID` (optional; roles given by Get started; without them the bot uses, or creates, roles named PlayStation and Xbox)
- `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID`, `STRIPE_WEBHOOK_SECRET` (optional; T.C.P Premium payments, see below), `STRIPE_YEARLY_PRICE_ID` (optional; a yearly price of the same product, adds a **Yearly** button)
- `ELITE_ROLE_ID`, `ELITE_WELCOME_CHANNEL_ID` (optional; the role paying members get and the channel they are welcomed in; without them the bot uses a role named Elite Supporter and a text channel with "elite" and "welcome" in its name)
- `WELCOME_GREET` (optional, default true; `false` keeps the Start here panel but stops per-member greetings)
- `WELCOME_MEMBER_INTENT` (optional, default true; `false` stops the bot asking for the Server Members Intent)
- `LICENSE_REMINDERS` (optional, default true; `false` stops expiry reminder DMs)
- `LICENSE_TRIAL_DAYS` (optional, default 14; there is no free trial any more, this only labels members who were given one before)
- `LICENSE_MAX_CODES` (optional, default 1; new numbers each member may get a code for per day)
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

**Who can generate.** Only members with the **Elite Supporter** role (see Premium script and the Elite role) and the owner. Everyone else is told codes are for Elite Supporters and shown **Subscribe**; the role is checked when the button is pressed and again when the number is sent. There is no free trial (members given one before keep its days, but cannot generate without the role). Whenever a member successfully gets a code, the bot also gives them the role in `LICENSE_MEMBER_ROLE_ID` (if set); for that the bot needs the **Manage Roles** permission and its own role must sit above the member role.

**Code sharing.** Each member may get a code for one new number a day (`LICENSE_MAX_CODES`). When a member has made codes for 3 or more different numbers (Zens) within 7 days, `LOG_CHANNEL_ID` gets a **Possible code sharing** alert listing the numbers, again for each further number; **End access** stops them.

**Owner panel.** With `LICENSE_ADMIN_CHANNEL_ID` and `OWNER_USER_ID` set, the bot posts a second panel in that channel. Keep the channel private. Pick a member from the menu to see their subscription, then **Add days** or **End access**. **Add days** also gives the Elite Supporter role, since codes need it; **End access** takes it away, and warns when the member still has a Stripe subscription (cancel that in Stripe, or their next payment gives access back). Nobody can generate a code until they have been given days. The owner can always generate.

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

## Game script showcases

Each game T.C.P supports has its own channel with a showcase: an embed with the T.C.P banner (`assets/tcp-banner.png`), what the script does, a **Download** link button and a **How to install** button that gives private install steps. The games are listed in `GAME_SCRIPTS` in `src/games/gameScripts.ts`, each with its channel ID, download link and wording; DayZ is the first. To add a game, add an entry there and redeploy.

On startup the bot posts each showcase in its channel. It keeps a fingerprint of the wording in the install button's ID, so a redeploy leaves an unchanged showcase alone, and replaces the old one (deleting it and posting the new one) only when the wording, link or banner changed. The bot needs View Channel, Send Messages, Embed Links, Attach Files and Read Message History in each game channel; members only need to see it.

The welcome guide's **Download** button lists these channels. `DOWNLOAD_CHANNEL_ID` is only used when `GAME_SCRIPTS` is empty.

## Info channels

The bot keeps one post of its own in each of four info channels: **Overview**, **FAQ**, **Disclaimer** and **Rules**. Each post is a single message of several embeds; the wording is in `src/info/infoContent.ts` (taken from the knowledge file; keep the two in step) and the channel IDs, with their defaults, in `src/info/infoChannels.ts`. `INFO_OVERVIEW_CHANNEL_ID`, `INFO_FAQ_CHANNEL_ID`, `INFO_DISCLAIMER_CHANNEL_ID` and `INFO_RULES_CHANNEL_ID` move a channel (their own names, so the older `FAQ_CHANNEL_ID` and `RULES_CHANNEL_ID` can never point the first-run clean-up at another channel).

The bot knows its post by the first embed's author line (for example "T.C.P · FAQ"). On startup, per channel:

- **No post of the bot's yet (first run):** it deletes every other message in the channel (bulk delete for messages under 14 days, one by one for older), then posts. Without **Manage Messages** it can only delete its own messages: it says so in the log, posts anyway, and you delete the rest by hand.
- **Post already there:** it edits the post in place only when the wording changed, and touches nothing else, so you can still post in the channel.
- If you delete the bot's post by hand, the next startup counts as a first run and clears the channel again.
- It reads at most the last 1000 messages; in a channel busier than that without its post it neither deletes nor posts.

The bot needs View Channel, Read Message History, Send Messages, Embed Links and Manage Messages in these four channels. Without Read Message History it leaves the channel alone (it could not find its own post and would post again at every startup).

## Reviews and the star rating

With `REVIEW_CHANNEL_ID` set, the bot posts a **Leave a review** panel there. A member picks 1 to 5 stars, writes a review (a headline is optional) and it is posted in that channel as a card. Each member has one review: leaving another replaces the old card, so the average counts everyone once. A member can update their review once every ten minutes. Every card has a **Remove** button that only the owner can use, which takes the review down and out of the average.

The panel shows the average, the number of reviews and how many gave each star count, and moves back to the bottom of the channel after each review. Members only need to see the channel; the bot posts there, so you can deny them Send Messages.

**Rating in the channel list.** Set `REVIEW_VOICE_CHANNEL_ID` to a voice channel and the bot renames it to show the rating, for example `⭐⭐⭐⭐⭐ 4.8 (23 reviews)`: the stars are the average rounded to whole stars. It is renamed at startup and after each review or removal. Discord allows only two renames per channel every ten minutes, so the bot renames at most once every five minutes and always uses the rating at that moment; a burst of reviews shows up within five minutes. Create the voice channel yourself, give the bot **Manage Channels** on it, and deny @everyone **Connect** so it works as a sign rather than a room.

Reviews are stored in Postgres when `DATABASE_URL` is a Postgres address (the `reviews` table), otherwise in the local SQLite file, which a redeploy clears. The bot needs View Channel, Send Messages, Embed Links and Read Message History in the review channel.

## Embeds

Every message the bot sends is an embed in one style (`src/bot/embeds.ts`): T.C.P red by default, and a "T.C.P Assistant" footer with the bot's own avatar as its icon, so set the T.C.P logo as the bot's avatar. Pings stay in the message text, because Discord does not notify mentions inside an embed. Long AI answers are split across several embeds.

## Welcome and Get started

With `WELCOME_CHANNEL_ID` set, the bot posts a **Start here** panel with a **Get started** button, buttons for private guides (Get my licence, Download, Settings, Get help, Rules; each only when its channel is set), and a **Server guide**: every category and channel that @everyone can see, with a short note from each channel's topic. The guide updates itself about 30 seconds after channels are added, renamed, moved or deleted. It never lists channels @everyone cannot see, or ticket channels.

Each new member gets a welcome card in that channel that pings them, shows their member number and has **Get started** and **Rules** buttons. **Get started** asks two questions privately (PlayStation or Xbox; do they have T.C.P on their Zen yet), gives them a PlayStation or Xbox role, and shows a checklist worded for their controller with links to the right channels. The roles come from `PLAYSTATION_ROLE_ID` / `XBOX_ROLE_ID`, or roles with those names, or are created; the bot needs **Manage Roles** and its own role above them. Choosing the other controller later swaps the role.

New members are seen through Discord's **Server Members Intent**, which must be switched on in the Discord Developer Portal (your application → Bot → Privileged Gateway Intents → Server Members Intent). The bot only asks for it when a welcome channel is set and greetings are on. If Discord refuses it because it is still off in the portal, the bot logs an error saying so and connects again without it, so it stays online; it then greets from Discord's own "joined the server" message instead, which needs *Send a random welcome message when someone joins* on in Server Settings → Overview. Only one of the two greets, so nobody is welcomed twice. The startup log says which is in use.

## Payments (T.C.P Premium through Stripe)

With `STRIPE_SECRET_KEY` and `STRIPE_PRICE_ID` set, the licence panel gets **Subscribe** (showing the live price, for example "Subscribe · $7.00/month") and **Manage subscription** buttons; they also appear under **My licence**, in Licence & codes tickets, and when a member's access has ended.

- **Subscribe** opens a Stripe Checkout page made for that member's Discord account (it is in `client_reference_id` and the subscription's metadata), so the payment finds its way back without anyone typing an ID. Members never enter card details in Discord.
- **Yearly** (with `STRIPE_YEARLY_PRICE_ID`, a yearly price of the same product): the same Checkout for the yearly price; the button shows it, for example "Yearly · $70.00/year". Someone already subscribed who presses Subscribe or Yearly gets the portal instead, never a second subscription.
- Every paid invoice for a new or renewing subscription adds its billing period's days (30 or 31 for monthly, 365 for yearly) to the member's licence, the same as the owner's **Add days**, and gives `LICENSE_MEMBER_ROLE_ID`. The member gets a DM receipt and `LOG_CHANNEL_ID` gets a log line.
- **Switching plan** in the portal (turn on *Customers can switch plans* in Stripe's Customer portal settings with both prices, prorations invoiced at once, and downgrades scheduled for the end of the period): monthly to yearly is billed at once (the yearly price less a credit for the unused month), and the bot extends the licence to the end of the new yearly period rather than adding a year on top, since the credit already paid for the rest of the month. Yearly to monthly then happens at the end of the paid year. Plan-change invoices made only of proration lines, or paid entirely by credit, add nothing.
- **Manage subscription** opens Stripe's Customer Portal: cancel, resume, change card, invoices. A cancelled subscription stops renewing and the remaining days simply run out.
- Failed payments, cancellations, refunds and chargebacks are logged to `LOG_CHANNEL_ID`. Refunds and chargebacks do not take days away; use **End access** if they should.
- Members whose subscription renews by itself get no expiry reminder DMs; everyone else's reminders point at **Subscribe**.
- The bot only acts on events Stripe signed (checked with `STRIPE_WEBHOOK_SECRET`), and handles each event once, so Stripe's retries never add days twice. Records are in the `stripe_subscriptions` and `stripe_events` tables (Postgres when `DATABASE_URL` is one).

**Setting it up** (use Stripe's test mode first: test keys and a test price, and pay with Stripe's test cards):
1. In Stripe, create a product (for example "T.C.P Premium") with a recurring monthly price. Put its price ID (`price_...`) in `STRIPE_PRICE_ID`.
2. Put the secret key (`sk_test_...`, later `sk_live_...`) in `STRIPE_SECRET_KEY`. A restricted key works too if it can write Checkout Sessions, Customer Portal sessions and read Prices, Charges, Customers and Subscriptions.
3. Give the Railway service a public domain (Settings → Networking → Generate Domain). The bot listens on `PORT` for `POST /stripe/webhook` (and `GET /health`).
4. In Stripe → Developers → Webhooks, add an endpoint `https://<your-domain>/stripe/webhook` with the events `checkout.session.completed`, `invoice.paid`, `invoice.payment_failed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `charge.refunded` and `charge.dispute.created`. Put its signing secret (`whsec_...`) in `STRIPE_WEBHOOK_SECRET`.
5. In Stripe → Settings → Billing → Customer portal, turn on cancelling subscriptions and updating payment methods, and save.

The startup log says whether Stripe is ready and in test or live mode. Test and live mode have separate keys, prices and webhook secrets; switch all three together.

### Premium script and the Elite role

On a member's **first** payment the bot also:
- DMs them the Premium script (`Tactical Competitive Pro Release.gpc`) with install steps;
- gives them the **Elite Supporter** role (`ELITE_ROLE_ID`, or a role with that name);
- welcomes them, with a ping, in the elite welcome channel (`ELITE_WELCOME_CHANNEL_ID`, or a text channel with "elite" and "welcome" in its name).

Renewals only make sure they still have the role. When the subscription ends (cancelled and run out, or deleted in Stripe) the role is taken away; their licence days still run out as normal. If their DMs are closed, or no script is uploaded yet, `LOG_CHANNEL_ID` says so. Elite Supporters, subscribers and the owner also get a **Download Premium** button on the licence panel, under **My licence** and in Licence & codes tickets, which sends the current script privately.

**The script is never in this repository**, which is public. The owner uploads it in Discord with `/tcp release` and attaches the file; it is stored in the `premium_files` table (Postgres when `DATABASE_URL` is one). Only the **scrambled** release is accepted (`python tools/make_play_build.py --license --scramble` in the script project): the readable release, which contains the real licence key, and the debug, play and free builds are refused. `/tcp release` with no file shows which script is live and its fingerprint. Upload again whenever there is a new build; Download Premium always gives the latest.

**Fingerprints and `/tcp trace`.** Every copy the bot sends (the DM and Download Premium) is personal: it carries one extra `define` line with an unused scrambled name, just above the file's own highest name, and a random value, placed among the script's other defines. An unused define changes nothing when the script runs, and in the scrambled file it looks like the hundreds around it. Each member keeps the same mark for the same upload; a new upload gives them a new one. The marks are in the `premium_marks` table. **`/tcp sync`** (owner only) runs the first-payment welcome again for a member, or for the owner when no member is given: the Elite role, the script by DM and the post in the elite welcome channel. It is for members who paid before the welcome existed, or whose DM or role failed; it replies with what worked. Members other than the owner need a live subscription. Each run posts a new welcome.

If a copy turns up somewhere, the owner runs `/tcp trace` with the file attached, and the bot says whose copy it is (it still finds the line if the file was re-saved with other spacing). It cannot trace copies sent before fingerprints began, or one where someone found and deleted the line.

The bot needs **Manage Roles**, with its own role above Elite Supporter, and Send Messages and Embed Links in the elite welcome channel. It will not hand out a role that has moderator permissions. The startup log names the Elite role and channel it found, or says "not found".

## Help channel

With `HELP_CHANNEL_ID` set, the assistant answers every message in that channel, no @mention needed. It starts a thread on each question and answers inside it, so conversations do not mix; replies in the thread continue the same conversation. Each answer has **Solved** (only the asker or the owner; archives the thread) and **Still stuck? Open a ticket** (opens a Setup & tuning ticket with the question filled in). The owner's own messages are not answered unless they @mention the bot, and once the owner writes in a member's thread the assistant leaves that thread to them. The bot posts a panel at the top of the channel explaining this, with the ticket buttons when `TICKET_PANEL_CHANNEL_ID` is not set. The bot needs View Channel, Send Messages, Send Messages in Threads, Create Public Threads, Embed Links and Read Message History there; without Create Public Threads it answers in the channel instead.

**Keeping the channel tidy** (`src/help/helpCleanup.ts`). Once a member is done, their thread is deleted together with the question it was started from: 5 minutes after **Solved** (unless they write again), or once the thread has had no messages for a day. Before that, `TICKET_LOG_CHANNEL_ID` (or `LOG_CHANNEL_ID`) gets a **Help thread cleared away** entry with the member, the outcome and the full conversation as a `.txt` file, so the owner can still read every answer. Messages left in the channel itself (outside threads) go after a day, except pinned messages, the owner's messages and the help panel. Only threads the bot started are touched. A sweep runs a minute after startup and every 10 minutes, at most 20 threads at a time. It needs **Manage Threads** and **Manage Messages** in the help channel; without them the startup log says so and nothing is deleted.

Answers everywhere (help channel, @mentions, `/tcp ask`, tickets) know the server's channels the member can see, so the assistant links them, for example the licence channel when someone asks for a code. Channels the member cannot see are never named.

## Tickets

With `SUPPORT_CATEGORY_ID` set, T.C.P runs its own tickets. A member picks a type (**Licence & codes**, **Setup & tuning**, **Bug report**, **Payment & other**) on the ticket panel or with **Still stuck** under a help answer, fills in a short form, and gets a private channel such as `#ticket-0042-name` in that category that only they, the owner and the bot can see. One open ticket per member.

- **Licence & codes**: the owner is pinged and the member's licence status (days left, latest code) is posted straight away.
- **Setup & tuning** and **Bug report**: the assistant takes a first look and answers follow-ups; **Call the owner** pings the owner once. The assistant stops answering once the owner presses **Claim** or writes in the ticket (it still answers if the member @mentions it).
- **Payment & other**: the owner is pinged.
- **Close ticket** (member or owner, with a confirmation) posts a plain-text transcript to `TICKET_LOG_CHANNEL_ID` (or `LOG_CHANNEL_ID`), DMs it to the member, and deletes the channel 10 seconds later. Opening a ticket is logged there too.

Tickets are stored in Postgres when `DATABASE_URL` is a Postgres address (the `support_tickets` table), otherwise in the local SQLite file. Ticket numbers keep counting across redeploys only with Postgres. The bot needs **Manage Channels** in the support category, plus View Channel, Send Messages, Embed Links, Attach Files and Read Message History. If another ticket bot also creates channels in that category, remove its panel so members only see one; the bot still greets channels it did not create.

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
