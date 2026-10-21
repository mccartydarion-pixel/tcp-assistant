import type { QueuedAnnouncement } from './announcementQueue.js';

/**
 * Announcements written in code. On every start the bot posts each entry that is `ready: true`, has never
 * been posted and is at most 14 days old, oldest first, to ANNOUNCEMENT_CHANNEL_ID. See "Queued
 * announcements" in the README for how to add one.
 *
 * Never change an entry's `id` once it has been posted: the id is how the bot knows it already posted it.
 */
export const ANNOUNCEMENT_QUEUE: QueuedAnnouncement[] = [
  {
    // Gen 7 recoil engine, Gen 7.1 and the intent-aware ADS Accuracy 2.0 (Premium, 2026-10-21).
    id: '2026-10-gen7-engine',
    date: '2026-10-21',
    ready: true,
    title: '🔥 PREMIUM UPDATE: THE GEN 7 RECOIL ENGINE',
    description:
      'The biggest T.C.P Premium update yet is **live**. 💎\n\n' +
      '**Gen 7** is a new way of delivering your recoil pull. Same Vertical, same Horizontal, same Workshop pulls, but now the script **reads your thumb** every 4 ms and gets out of the way the moment you move on purpose.\n\n' +
      '🎯 **Track sideways and the gun stays down.** The pull lets go per axis: a sideways track keeps the vertical hold.\n' +
      '⚡ **Your stick wins, fast.** Flicks, snaps, turns and reversals release the pull in a few hundredths of a second; it comes back smoothly as you settle.\n' +
      '🧊 **Clean release.** Stop firing and the pull is gone almost at once. No more nudge after a burst.\n' +
      '🔬 **High-resolution aim reading** (Gen 7.1): the stick is read at its full native resolution, so even a third of a unit counts.\n\n' +
      '🎮 **ADS Accuracy 2.0 is now intent-aware.** Precision, Response and Easing apply themselves where they help: steady on tiny corrections, natural while tracking, instant on snaps and turns. **Precision no longer slows your stick**: it steadies it.',
    fields: [
      { name: '🛠️ Nothing to set up', value: 'Download, flash, play. Your settings carry over. Motion Intel makes no difference now: leave it off.', inline: false },
      { name: '🎯 Tips', value: 'Tuned Precision for a slow centre before? Set it 30 to 60 for steadiness and use **ADS Sens** for speed. Everything else: same values as before.', inline: false },
      { name: '⬇️ Get it', value: 'Press **Download Premium** on the licence panel. Not Premium yet? **Subscribe** there. Questions? Ask in **#ask-tcp**.', inline: false },
    ],
    gif: 'tcp-gen7-engine.gif',
    ping: '@everyone',
  },
  {
    // Premium round 8. Set ready: true once the round-8 build is uploaded with /tcp release.
    id: '2026-10-workshop-mag',
    date: '2026-10-20',
    ready: true,
    title: '🎯 WORKSHOP UPGRADE: THE MAG ITEM IS HERE',
    description:
      'The Weapon Workshop just got **sharper**. 💎\n\n' +
      'Running a **60-round M4**? A **20-round KA-M**? Tell the Workshop. The new **Mag** item sets the rounds in your magazine, and the recorder now measures **your** real spray instead of a standard mag.\n\n' +
      '📊 The progress bar now fills over **the whole spray**, so you can watch it work.\n' +
      '🔫 Every slot keeps its own gun **and** its own mag.\n' +
      '✅ Left on the standard mag? It records **exactly** like before.',
    fields: [
      { name: '🛠️ How', value: 'Workshop page (**L2 + OPTIONS**, then **LEFT**) → **Mag** (3/7) → **Up/Down** (hold **X** for 10).', inline: false },
      { name: '⚠️ One-time reset', value: 'This update clears the Workshop **once**. Record your guns again (3 mags each) and you are back in business. Your other settings are kept.', inline: false },
      { name: '⬇️ Get it', value: 'Press **Download Premium** on the licence panel. Questions? Ask in **#ask-tcp**.', inline: false },
    ],
    gif: 'tcp-workshop-mag.gif',
    ping: '@everyone',
  },
  {
    // Free version. Set ready: true once the new free build is on the marketplace.
    id: '2026-10-free-profiles',
    date: '2026-10-20',
    ready: true,
    title: '🔫 FREE UPDATE: WEAPON PROFILES',
    description:
      'The **free** T.C.P just levelled up. 🚀\n\n' +
      '**3 Weapon Profiles** (P1, P2, P3): give each gun its own **Vertical** and **Horizontal**, then switch between them in a second.\n\n' +
      '🎯 One profile per gun, no more retuning every time you swap.\n' +
      '⚡ The Vertical and Horizontal pages tune whichever profile you are on.\n' +
      '✅ Profile **OFF** (the default) plays exactly like before.',
    fields: [
      { name: '🛠️ How', value: 'Open the menu (**L2 + OPTIONS**), press **LEFT** once → **PROFILES** → **Up/Down** to pick P1-P3, **L1/R1** to set its V and H.', inline: false },
      { name: '💎 Want it recorded for you?', value: '**T.C.P Premium** has the **Weapon Workshop**: spray 3 mags at a wall and it records the exact pull each gun needs. Press **Subscribe** on the licence panel.', inline: false },
      { name: '⬇️ Get it', value: 'Grab the latest free version from the marketplace. Questions? Ask in **#ask-tcp**.', inline: false },
    ],
    gif: 'tcp-free-profiles.gif',
    ping: '@everyone',
  },
  {
    // Internal example of the shape. It is a draft (ready: false), so it is never posted.
    id: '0000-example',
    date: '2026-10-20',
    ready: false,
    title: 'T.C.P update: example title',
    description: 'What is new, in a sentence or two. **Bold** and line breaks work.',
    fields: [
      { name: 'Version', value: '1.0', inline: true },
      { name: 'Get it', value: 'Download it in the downloads channel.', inline: true },
    ],
    gif: 'example.gif',
    ping: 'none',
  },
];
