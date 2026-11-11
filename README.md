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

## Queued announcements

Update announcements can also be written in code, so each T.C.P release is announced the moment the new bot version starts. The queue is `src/announcements/queue.ts`; GIFs go in `assets/announcements/`.

On every start, once the bot is connected and its panels are in place, it posts each entry that is **ready**, **never posted** and **at most 14 days past its date**, oldest first, to `ANNOUNCEMENT_CHANNEL_ID`. Each entry is one message: the ping (if any), a T.C.P embed, and the GIF attached and shown as the embed's image.

To add one:

1. Put the GIF in `assets/announcements/` (a plain file name: letters, digits, `.`, `_`, `-`; `.gif`, `.png`, `.jpg` or `.webp`; **8 MB at most**, Discord's limit for a server without boosts).
2. Add an entry to `ANNOUNCEMENT_QUEUE` in `src/announcements/queue.ts`:

   ```ts
   {
     id: '2026-10-workshop-mag',     // stable and unique; never change it once posted
     date: '2026-10-21',             // the day you wrote it (YYYY-MM-DD)
     ready: true,                    // false keeps it as a draft: never posted
     title: 'T.C.P Premium: the Mag item is here',
     description: 'What is new, with **bold** and line breaks.',
     fields: [{ name: 'Version', value: 'Round 8', inline: true }], // optional, up to 25
     url: 'https://...',             // optional: the title links here
     gif: 'workshop-mag.gif',        // optional: a file in assets/announcements/
     ping: '@everyone',              // optional: '@everyone', a role ID (digits) or 'none'
   },
   ```

3. Run `npm test` (it checks every entry in the real queue: ids, dates, Discord's embed limits, and that each ready entry's GIF is there and under 8 MB), commit, push and let Railway redeploy. The announcement goes out when the new version starts.

Rules the bot keeps:

- **Never twice.** Each posted id is recorded in the database (the `queued_announcements` table in Postgres when `DATABASE_URL` is a Postgres address, otherwise `queuedAnnouncements` in the SQLite file, which a redeploy clears; use Postgres so a redeploy cannot repost). The row is written as *sending* before the message goes out and becomes *posted* once Discord confirms it.
- **Never lost silently.** If the bot stops between those two steps, the entry stays *sending*: every start logs it as a warning and it is **not** retried by itself, because it may already be in the channel. Look in the channel; if it is missing, run `/tcp announcements retry:<id>`, which clears it and posts it. If Discord refuses a message outright (a 4xx answer, e.g. missing permissions), it was certainly not posted, so the record is cleared and it is tried again on the next start. A failed send stops the run so later entries keep their order.
- **Drafts wait.** Entries with `ready: false` are never posted (or checked), so a draft can sit in the queue without its GIF.
- **No old news.** A ready entry never posted by 14 days after its `date` is skipped with a log line, so a fresh database never floods the channel. To post it anyway, give it today's date.
- **All or nothing.** If anything due is wrong (an embed over Discord's limits, a missing or oversized GIF, a bad ping, a duplicate id or bad date anywhere in the queue, or `ANNOUNCEMENT_CHANNEL_ID` missing or not a channel the bot can see), the bot logs a clear `[TCP Announcements ERROR]` line for each problem and posts nothing; fix it and redeploy. Text is never cut short.

`/tcp announcements` (owner only, private reply) lists the queue in posting order with each entry's status: POSTED, PENDING, DRAFT, UNSURE (was sending) or SKIPPED (over 14 days old).

The bot needs View Channel, Send Messages, Embed Links and Attach Files in the announcement channel, and Mention Everyone for an `@everyone` or role ping (unless the role is mentionable). The build copies the whole repository (Railpack, and `COPY . .` in the Dockerfile; there is no `.dockerignore`), so files in `assets/announcements/` ship with the bot.

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
- DMs them the Premium script (`T.C.P Premium.gpc`) with install steps;
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

With `SUPPORT_CATEGORY_ID` set, T.C.P runs its own tickets. A member picks a type (**Licence & codes**, **Setup & tuning**, **Bug report**, **Payment & other**) on the ticket panel or with **Still stuck** under a help answer, fills in a short form, and gets a private channel such as `#ticket-0042-name` in that category that only they, the T.C.P team and the bot can see. One open ticket per member.

**The team** (`src/bot/staff.ts`) is the owner, every member of a staff role, and anyone with the Administrator permission. Staff roles are `TICKET_STAFF_ROLE_IDS` (comma-separated role IDs) or, when that is unset, the roles named Admin, Administrator, Moderator, Mod, Staff, Support or Helper (exact names, ignoring case, emoji and dashes, so "Elite Supporter" is not one). New tickets give the staff roles access; at startup the bot lets them into tickets already open and logs which roles it found. Anyone on the team can reply, **Claim**, **Close** and is pinged where the owner is; when they write in a ticket the assistant steps back, as for the owner. The same goes for help threads: a staff member's messages there are not answered unless they @mention the bot, and they can press **Solved**.

- **Licence & codes**: the team is pinged and the member's licence status (days left, latest code) is posted straight away.
- **Setup & tuning** and **Bug report**: the assistant takes a first look and answers follow-ups; **Call the team** pings the owner and the staff roles once. The assistant stops answering once someone on the team presses **Claim** or writes in the ticket (it still answers if the member @mentions it).
- **Payment & other**: the team is pinged.
- **Close ticket** (the member or the team, with a confirmation) posts a plain-text transcript to `TICKET_LOG_CHANNEL_ID` (or `LOG_CHANNEL_ID`), DMs it to the member, and deletes the channel 10 seconds later. Opening a ticket is logged there too.

Tickets are stored in Postgres when `DATABASE_URL` is a Postgres address (the `support_tickets` table), otherwise in the local SQLite file. Ticket numbers keep counting across redeploys only with Postgres. The bot needs **Manage Channels** in the support category, plus View Channel, Send Messages, Embed Links, Attach Files and Read Message History. If another ticket bot also creates channels in that category, remove its panel so members only see one; the bot still greets channels it did not create.

**Ratings, response times and the weekly summary** (`src/tickets/ticketFeedback.ts`). The transcript DM on closing has 1-5 star buttons; a rating of 1 or 2 is flagged in the ticket log channel. The first time someone on the team writes in a ticket (or claims it) is recorded. Every 7 days the ticket log channel gets a **Weekly support summary**: tickets opened and closed (and how many closed for no reply), the median time to the team's first reply, the average rating, and per team member the tickets they took and their rating. `support_tickets` gained `rating` and `first_response_at` (added automatically).

**Auto-close** (`autoCloseAction` in `src/tickets/ticketRules.ts`). Every half hour: a ticket where the team spoke last (a person other than the member, or the assistant's first look) and the member has not answered for 48 hours gets a **Closing soon** warning with an **I still need help** button; 24 hours later without a reply it closes as usual, transcript and rating included. A member waiting for the team is never closed, and the bot's own notices (the intro, the license card, Team called) do not count as the team answering.

**Support hours** (`src/tickets/supportHours.ts`, owner): `/tcp hours from:10:00 to:22:00 timezone:America/New_York days:mon-fri` (days: every day, weekdays, weekends, mon-fri, mon,wed,fri; a window past midnight works), `/tcp hours` alone shows them, `/tcp hours off:True` turns them off. The ticket panel (or the help panel that carries the ticket buttons) shows **Support is online now** with the usual reply time (median of the last 30 days, once there are 3 replies), or **Support is offline** and when it is back, as a Discord timestamp in each member's own time; a ticket opened while offline says when the team will answer. The panels redraw when support opens or closes. Kept in the `bot_state` table.

## Fix my aim (tuning wizard)

`src/tuning/tuningWizard.ts`: a **🎯 Fix my aim** button on the help channel panel and `/tcp tune`. A private walk-through: Premium or free (and, on Premium, a recorded Workshop slot or not), the DayZ sensitivity check, then the problem (climbs, sinks, drifts left or right, hard to stay on target, too fast, laggy or floaty, small movements then a jump, moves at rest), then one change at a time from the Tuning Guide in the documentation (`src/tuning/tuningWizardRules.ts`), with **Fixed**, **Better, not yet**, **No change** and **Worse**. A step that helps is repeated up to its limit; **Worse** says to put the setting back. Premium names the Menu 2.0 groups and uses Scale Y / Scale X on a recorded pull (Vertical and Horizontal are locked there); the free version names its pages. At the end it offers a Setup & tuning ticket with everything tried filled in.

## Tic Tac Toe

`/tcp tictactoe` (optional `difficulty`: Easy, Normal, Hard) posts a board of nine buttons in the channel; the member is ❌ and plays first, T.C.P answers with ⭕ in the same update. Only the member who started can press the buttons (anyone else is told to start their own). Hard plays perfectly (minimax over the whole game, a random choice between equally good moves), Normal takes a win, blocks yours and otherwise plays its best 60% of the time (a fork beats it), Easy takes a win when it sees one and otherwise plays anywhere (`src/fun/ticTacToeRules.ts`). The game lives entirely in the buttons' IDs (`tcp-ttt:`), so it survives a redeploy and nothing is held in memory; a second press sent before the board redrew is ignored. At the end: **Play again** (who went second goes first), the other two difficulties and **🏆 Leaderboard**.

**Player vs player**: `/tcp tictactoe opponent:@member` posts a challenge that pings the member, with Accept / Decline (theirs) and Withdraw (the challenger's); it expires after 10 minutes. The challenger is ❌ and moves first; only the player on turn can press a square (X always moves first, so the turn follows from the board). Either player can **Give up** (the other wins); the waiting player can **Claim win** once the other has not moved for 2 minutes (the last move's time travels in the button IDs, so this too survives a redeploy). **Rematch** swaps the sides. Self-challenges and bots are refused; challenging T.C.P itself starts a game against the bot.

**Leaderboard** (`/tcp leaderboard`, public; the 🏆 button, private): the top 10 player vs player (3 points a win, 1 a draw) and the top 5 against T.C.P (a win on Easy 1, on Normal 3, a draw on Normal 1, a draw on Hard 2), each with W-L-D, and the viewer's own place. Ties: more wins, then fewer losses. All records are one JSON value in the `bot_state` table (`ttt.stats`: name, PvP W-L-D, and W-L-D against T.C.P per difficulty), changed one game at a time so two games ending together both count (`src/fun/ticTacToeStats.ts`). Giving up and running out of time count as losses. Nothing stops a member from farming wins off a second account; the leaderboard is for fun.

## Casino (play money)

`/casino` (`src/casino/`): Blackjack, Slots, Mines and Coinflip for free chips. **Play money only**: chips are never sold, never tradeable between members (no `give` or `pay`, so no farming with second accounts or selling chips outside Discord) and never exchangeable for Premium days, the license, roles that unlock anything or payouts; never connect them to Stripe or the boost reward. That keeps it within Discord's rules on gambling.

- **Where**: games only in a text channel whose name contains `casino` (the owner can test anywhere); `balance` and `daily` reply privately anywhere, `leaderboard` publicly in the casino channel and privately elsewhere. Until such a channel exists, members are told the casino is not open yet.
- **Chips** (`casinoStore.ts`, one JSON value in `bot_state`, `casino.players`): 1,000 to start; `/casino daily` every 20 h, 500 + 50 a day of streak (kept within 48 h) up to +500; a 100-chip bailout every 2 h for a broke member (under 10, nothing in play) whose daily is not ready. Bets 10-10,000, at most 3 games at once. Every change runs one at a time, and the value is read strictly (`getStateStrict`): if it cannot be read, nothing is written over it.
- **Bets are held, not lost**: a game's bet moves into `inPlay` under the game's ID when it starts and is paid out (or not) when it ends; settling twice pays nothing. Games live in memory (the cards and the mines never go into the buttons), so on startup every bet still held is refunded (`initCasino`). A hand or Mines game untouched for 5 minutes is finished for the player by a sweep (Blackjack stands; Mines cashes out, or refunds with no tile picked); a duel nobody accepts expires after 10 minutes and is refunded.
- **The games** (`casinoRules.ts`, tested): Blackjack from a fresh 4-deck shoe each hand, dealer peeks for blackjack and stands on all 17s, blackjack 3:2, Double on two cards, no split or insurance. Slots: 5 weighted symbols, three of a kind or any pair, about 95% back on average (`slotsReturn`). Mines: 20 tiles, 1-10 mines, cash out pays 97% of the fair odds, capped at 1,000x. Coinflip: 1.95x against the house; a duel (`opponent:`) pings the member, holds both bets and pays the winner both. The random numbers come from `crypto.randomInt`.

## Game communities (opt-in categories)

`src/communities/communities.ts`. A **community** is any category with a channel whose name contains `lfg` and one whose name contains `script` (DayZ, Battlefield 6, ...), so a new game appears by itself. For each the bot makes (or finds by name) a role named after the game without its decoration (`· Battlefield™ 6` → `Battlefield™ 6`), remembered by category in `bot_state` (`communities.roles`).

- **The picker**: a panel in the text channel whose name contains `communities` (outside every community): a button per game (join / leave, private reply) and **📋 My communities**. The welcome panel gets a **🎮 Pick your communities** link to it.
- **Opt-in** (the owner's choice, 2026-11-10: hidden until picked, current members too): each community's category and every channel in it are set to View Channel denied for `@everyone` and allowed for the community role, the staff roles and the bot (one overwrite flag each; every other permission kept). Squad Finder's private squad channels are left alone. **Nothing is hidden until the picker panel is posted**, so nobody is locked out with no way to pick.
- Runs at startup and 20 s after any channel change (a new category, a rename, the picker channel made). The bot needs **Manage Roles** (its role above the community roles) and **Manage Channels**.

## Squad Finder (LFG)

`src/lfg/`: matchmaking instead of LFG messages. One **community** per server category that has a text channel with `lfg` in its name (`COMMUNITIES` in `lfgRules.ts`: DayZ, a category whose name contains `dayz`; Battlefield 6, `battlefield`); each has its own platforms, crossplay rule, largest squad, card name and wording (Survivor ID / Soldier ID), playstyles and servers or modes, queue, squads and panel. DayZ: PlayStation and Xbox, no crossplay, squads up to 5. Battlefield 6: PlayStation, Xbox and PC with crossplay (platform is not a hard filter), squads up to 4. Reputation is the member's own, across communities. Adding a game is one entry in `COMMUNITIES` and an lfg channel in its category.

- **The panel** (posted and kept up to date in the lfg channel, `ensurePanel`): searching now by platform and region, squads active and formed today, open squads; buttons 🎯 Deploy, 🪪 My Survivor ID, 🔓 Open squads, 🏆 Most trusted.
- **Survivor ID** (`lfg.players` in `bot_state`): platform (PlayStation / Xbox), region, language, up to 3 playstyles, mic, experience, server (Official, Community, Day & Nite), gamertag (shown only inside a squad), bio. A two-step private editor (selects) and a modal for the gamertag.
- **Queue and matching** (`lfgRules.ts`, tested): in memory (a restart clears the queue and the ready checks; members deploy again). Hard rules: same platform and language, same region (NA East and West mix after 3 min), the same trust tier, nobody either side reported, new and veteran not together in the first 2 min. Score 0-100: the session's mode (35), shared playstyles (15), mic (20), experience (15), server (15), +10 for mutual squadmates. The longest wait anchors (Elite Supporters count 3 minutes more), takes the best-fitting members up to its size; the minimum score is 55, 40 after 2 min, 25 after 5 min; a squad smaller than asked for forms after 5 min. Open squads (Looking for +1) are filled first. Runs every 10 s and right after a Deploy. The queue drops a member after 45 min.
- **Ready check**: a message in the lfg channel that pings the squad, 2 minutes to Accept; a decline or a timeout sends those who accepted back with their original time (the front of the queue). Deleted a minute after it resolves.
- **Squads** (`lfg.squads`): a private text channel `🪖・squad-<call-sign>` and voice channel `🔊 Squad <call sign>` in the community's category (members, the bot and staff roles can see them; the bot needs **Manage Channels** and **Manage Roles** there), with every member's card and gamertag and a Day & Nite tip when someone picked a community server. Gamertags, Looking for +1 / Close the slot, Leave, End squad. A sweep every 2 min ends a squad after 60 min with no message and nobody in voice (not in its first 20 min), or after 12 h; ended squads keep their channels 10 min for the ratings, then they are deleted. Voice occupancy needs the **GuildVoiceStates** intent (not privileged; added to the client).
- **Ratings** (`applyRatings`): on ending or leaving, each member rates the others once (in the channel, by DM for 24 h): commendations (shown as badges on the card and on 🏆 Most trusted), 🤝 Play again (mutual pairs get a DM when the other deploys, at most every 6 h, and +10 match score), 🗡️ Betrayed us (private; the two are never matched again; 3 different reporters in 60 days make a member low-trust: matched only with other low-trust members, and the log channel is told).

## Unanswered questions and teaching the assistant

When the documentation does not cover a question, the AI ends its reply with a marker the bot removes before replying (`src/ai/unansweredMarker.ts`). The bot then posts the question, who asked, where, and the closest documentation sections to `LOG_CHANNEL_ID`, at most once a day per question. Questions with no documentation match at all are logged too.

Each report has an **Answer this** button (the team only): it opens a form with the question and your answer, and the answer is used by the assistant at once (`src/knowledge/taughtAnswers.ts`; searched with the documentation as "Answers from the T.C.P team", which the system prompt treats as authoritative). `/tcp teach question answer` adds one by hand, `/tcp taught` lists them with their numbers, `/tcp forget number` removes one. They are kept in the `bot_state` table, not in the repository.

**Other languages** (`src/ai/language.ts`): a question that looks like another language (another alphabet, accented letters, or common Spanish, Portuguese, French, German or Italian words and no English ones) is translated to English with gpt-4o-mini for the documentation search only. The reply language is decided in code, not by the model (`replyLanguage`): English unless the message clearly is not; asking for English (in any language) always gives English; a message too short to tell ("im new", "ok") follows the member's last message that could be told, English when there is none; a message that is neither is left to the model, English if it cannot tell. It goes to the model as the last line of its instructions; a ticket's first look judges only what the member wrote, not the form's English labels. Setting names stay in English. (Left to the model, a ticket that said only "im new" was answered in Spanish.)

## Premium release alerts, leak watch and the daily Elite check

- **Release alerts** (`src/premium/releaseAlerts.ts`): `/tcp release` takes optional `notes` (what changed) and `notify` (default yes). A new file (not a re-upload of the same one) posts a **T.C.P Premium updated** card with the notes and a Download Premium button in the Elite Hub, and DMs every Elite Supporter their own fingerprinted copy with the notes, one every 1.2 s; the log channel gets the tally and who has DMs closed. Download Premium shows the latest notes too. The notes are kept in the `bot_state` table.
- **Leak watch** (`src/premium/leakWatch.ts`): every `.gpc` or `.txt` attachment (up to 2 MB) posted in the server is checked. If it carries a member's fingerprint, is built like the scrambled release, is any readable premium build, or is the owner's own upload, and the poster is not on the team, the message is deleted, the poster gets a DM saying why, and the log channel gets **Premium script posted** with whose copy it was. The team can post it, and members can post their own file in their private ticket. The bot needs Manage Messages in the channels to delete.
- **Daily Elite check and Veteran roles** (`src/premium/eliteAudit.ts`): once a day the Elite role is removed from members with no live Stripe subscription and no license days (the owner, staff and Administrators keep it). If that would remove more than max(5, 30%) of the role at once, nothing is removed and the owner is told. The very first run only reports. `/tcp audit` (owner) lists who would lose it, with a button to remove it. The same check gives **Veteran · 3 Months**, **Veteran · 6 Months** and **Veteran · 1 Year** (created on first need, no permissions; only the highest) to members whose subscription has run that long without a break, with a shout-out in the elite welcome channel, and takes them away when the subscription ends. Needs Manage Roles, the bot's role above these roles, and the Server Members Intent to see every member.
- **Owner stats** (`src/owner/stats.ts`): `/tcp stats` (owner only, private): paying subscribers (monthly, yearly; renewing, cancelled, failed payment), monthly revenue, what came in over 30 days, this week's new and ended subscriptions, license holders, the Elite role's size, and the week's support figures.
- Daily and weekly jobs remember when they last ran in the `bot_state` table (`src/bot/jobs.ts`), so a redeploy neither repeats nor skips them.

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
- `/tcp announcements` (owner only: the queued announcements and their status; see Queued announcements)
- `/tcp stats`, `/tcp audit`, `/tcp hours` (owner only; see above)
- `/tcp teach`, `/tcp taught`, `/tcp forget` (the team)
- `/tcp tune` (everyone: Fix my aim)
- `/tcp tictactoe` (everyone: Tic Tac Toe against T.C.P, or `opponent:@member` to challenge a member)
- `/tcp leaderboard` (everyone: the Tic Tac Toe leaderboard)
- `/casino balance | daily | leaderboard | blackjack | slots | mines | coinflip` (everyone; the games in the casino channel)
- `/tcp summarize`
- `/tcp escalate`
- `/tcp resolve`

## Troubleshooting

- If the knowledge document is missing, the bot will serve a safe fallback response instead of guessing.
- If OpenAI is unavailable, the bot still supports documentation FAQ responses, ticket collection, and command actions.
- If the database fails, the bot should continue in degraded mode without crashing.

## Notes

This project is intentionally a Discord support-only assistant and does not modify the Cronus Zen GPC source or game script.
