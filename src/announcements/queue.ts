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
    // The Gen 8 thumb-control fix: the shared pull per axis and on what F.A.S.T. delivers (Premium, 2026-10-24).
    id: '2026-10-thumb-fix',
    date: '2026-10-24',
    ready: true,
    title: '🎯 PREMIUM UPDATE: THUMB CONTROL FIX',
    description:
      'Your thumb is back in charge of the pull-down. 🔥\n\n' +
      'We traced a report that the M4 could feel like it spreads instead of staying on your point of aim, and found two real problems in how your own stick and the recoil pull worked together. Both are fixed:\n\n' +
      '⬇️ **PULL DOWN, IT COUNTS.** Pull down with the gun and it always adds. Before, F.A.S.T. made a light pull finer while the recoil engine still took half of the full stick away, so from a light pull to a firm one your thumb added almost nothing. Now the engine only shares what you actually deliver, the same way the hardware-proven Gen 8 build did.\n' +
      '↔️ **SIDEWAYS STAYS SIDEWAYS.** Small left-right corrections used to weaken the vertical hold by 3 the moment they passed a light touch. Now each axis is judged on its own: tiny sideways fixes keep the gun down.\n\n' +
      '🔫 **Nothing else changed.** Same Workshop pull, same Gen 8, same F.A.S.T. 2.0, same settings.',
    fields: [
      { name: '🛠️ Nothing to set up', value: 'Download, flash, play. Your settings and Workshop recordings carry over.', inline: false },
      { name: '🎯 Tip', value: 'If a gun still climbs in a long spray, raise its **Scale Y** 3 to 5. A pull a touch strong is easy to hold; a touch weak climbs. Record an M4 with a 60-round mag at **Mag 60** so the Workshop measures the whole spray.', inline: false },
      { name: '⬇️ Get it', value: 'Press **Download Premium** on the licence panel. Not Premium yet? **Subscribe** there. Questions? Ask in **#ask-tcp**.', inline: false },
    ],
    gif: 'tcp-thumb-fix.gif',
    ping: '@everyone',
  },
  {
    // Drop Roll: double L1 / R1 drops prone and rolls left / right (Premium, 2026-10-24).
    id: '2026-10-drop-roll',
    date: '2026-10-24',
    ready: true,
    title: '🌀 PREMIUM UPDATE: DROP ROLL IS HERE',
    description:
      'Get off the line of fire in one move. 🔥\n\n' +
      '**Double-tap L1** and you drop prone and roll **left**. **Double-tap R1** and you drop prone and roll **right**. One fast, chained move: drop, roll, and your controls are back the instant it ends.\n\n' +
      '👆 **Single taps stay yours.** One press of L1 or R1 is a normal lean, with no delay. Only a quick second press of the same button starts Drop Roll, and that second press never reaches the game.\n' +
      '🔁 **Clean every time.** Extra taps never restart it, a triple tap never doubles it, and nothing is ever left held down.\n' +
      '🔫 **Your aim and recoil are untouched.** Drop Roll never moves a stick and never touches your trigger.',
    fields: [
      { name: '🛠️ Switch it on', value: 'Off by default. Menu, **Drop Shot** page, press **R1** until it reads **8/8 Drop Roll**, press **X** for ON. It uses Drop Shot\'s **Hold Time** for the drop: if you only crouch, raise Hold Time.', inline: false },
      { name: '⬇️ Get it', value: 'Press **Download Premium** on the licence panel. Not Premium yet? **Subscribe** there. Questions? Ask in **#ask-tcp**.', inline: false },
    ],
    gif: 'tcp-drop-roll.gif',
    ping: '@everyone',
  },
  {
    // ACG, the Adaptive Control Guardian: the intelligence and guardian layer under Gen 8 (Premium, 2026-10-22).
    id: '2026-10-acg-guardian',
    date: '2026-10-22',
    ready: true,
    title: '🧠 PREMIUM UPDATE: MEET ACG, THE ADAPTIVE CONTROL GUARDIAN',
    description:
      'Gen 8 just got a brand new brain. 🔥\n\n' +
      '**ACG** is the new layer that reads your thumb for the Gen 8 Stable Core. Every 4 ms, at high resolution, it works out exactly what you are doing and how sure it can be:\n\n' +
      '👁️ **OBSERVE**: your stick, read finer than ever.\n' +
      '🧩 **INTERPRET**: steady hold, tracking, correcting, snapping, reversing.\n' +
      '🛡️ **GUARD**: it checks every single tick. Menu open, recorder armed, a timing hiccup? It falls back safely for that moment instead of guessing.\n\n' +
      'It replaces the old Motion Intel and Core layers with one cleaner, lighter engine.\n\n' +
      '🎮 **Tested on the Zen, in DayZ, on a PS5**, A/B against the hardware-proven Gen 8 build. The verdict: **"feels the same as the proven Gen 8 build."** No added drag, no twitchiness, no delay. The feel you trust, on a smarter foundation.',
    fields: [
      { name: '🛠️ Nothing to set up', value: 'ACG runs by itself. Your settings and Workshop recordings carry over. The Motion Intel page is gone from Premium: ACG does its job now.', inline: false },
      { name: '⬇️ Get it', value: 'Press **Download Premium** on the licence panel. Not Premium yet? **Subscribe** there. Questions? Ask in **#ask-tcp**.', inline: false },
    ],
    gif: 'tcp-acg-guardian.gif',
    ping: 'none',
  },
  {
    // F.A.S.T. 2.0, Free Aim Stability Technology: Premium's aim shaping, in place of ADS Accuracy (2026-10-22).
    id: '2026-10-fast2',
    date: '2026-10-22',
    ready: true,
    title: '🎯 PREMIUM UPDATE: F.A.S.T. 2.0 IS LIVE',
    description:
      '**Free Aim Stability Technology.** Your aim, shaped by how you actually move. 🔥\n\n' +
      'F.A.S.T. 2.0 replaces the old ADS Accuracy sliders with one system that reads your thumb through ACG every 4 ms and blends three responses, per axis:\n\n' +
      '🔬 **MICRO**: tiny corrections made finer, so they land exactly where you want. Full stick is still full stick.\n' +
      '🏃 **TRACK**: smooth, natural tracking through the middle of the stick.\n' +
      '⚡ **TURN**: snaps, big turns and hard reversals pass straight through. Never held back.\n\n' +
      'Track sideways and the axis you are not moving keeps its fine control. Not aim assist: it never moves your aim on its own, and it never touches your recoil pull.\n\n' +
      '🎮 **Tested on the Zen, in DayZ, on a PS5**, A/B against the old ADS shaping. The verdict: **"F.A.S.T. 2.0 feels good."**',
    fields: [
      { name: '🎛️ Four controls, all start at 50', value: 'The old ADS pages, renamed: **Micro Precision** (finer fine aim), **Track Response** (mid-stick tracking speed), **Turn Release** (turns pass through sooner), **Recovery Speed** (fine aim comes back faster). The update sets all four to 50 once. Your ADS Sens, ADS Vertical and Fire Sens carry over.', inline: false },
      { name: '🎯 Tip', value: 'Play a few fights at 50 before changing anything, then move one control 5 or 10 at a time. Overall speed is still **ADS Sens**.', inline: false },
      { name: '⬇️ Get it', value: 'Press **Download Premium** on the licence panel. Not Premium yet? **Subscribe** there. Questions? Ask in **#ask-tcp**.', inline: false },
    ],
    gif: 'tcp-fast2.gif',
    ping: '@everyone',
  },
  {
    // Gen 8, the Workshop Adaptive Stable Core: the final anti-recoil generation, hardware tested (Premium, 2026-10-21).
    id: '2026-10-gen8-stable-core',
    date: '2026-10-21',
    ready: true,
    title: '💎 PREMIUM UPDATE: GEN 8 STABLE CORE IS HERE',
    description:
      'Tested on the Zen, in DayZ, on a PS5. The verdict from the first session: **"feels freaking amazing."** 🔥\n\n' +
      '**Gen 8** is the final form of T.C.P recoil control, built around your **Weapon Workshop** pull. It reads your thumb every 4 ms and delivers exactly as much of your recorded pull as you want right now, in three regimes:\n\n' +
      '🎯 **PRECISION**: hold steady and you get the whole pull, held calm. No chatter, no fade.\n' +
      '🏃 **COMBAT**: tracking or correcting, only the axis you move gives way. The other keeps the gun down.\n' +
      '⚡ **MANEUVER**: snap, turn, hard reversal: the pull lets go and your stick wins, then it comes back smoothly.\n\n' +
      '🔫 **Your recording, as recorded.** A TIGHT Workshop recording is held calmer than a LOOSE one, and nothing is ever added to your pull.\n' +
      '📏 **Long range.** 25-50 m already felt good. 75-200 m, where it could get unstable, now feels much better.\n' +
      '🧊 **Clean release** and small corrections that stay yours: a tiny reversal never collapses the pull.',
    fields: [
      { name: '🛠️ Nothing to set up', value: 'Download, flash, play. Your settings and Workshop recordings carry over. Motion Intel still makes no difference: leave it off.', inline: false },
      { name: '🎯 Tip', value: 'Gen 8 delivers your **whole** pull in a steady hold. If you used to add a touch of thumb yourself, try Vertical (or Scale Y) one step lower. A slot that says REDO ONCE: record it again for the calmest hold.', inline: false },
      { name: '⬇️ Get it', value: 'Press **Download Premium** on the licence panel. Not Premium yet? **Subscribe** there. Questions? Ask in **#ask-tcp**.', inline: false },
    ],
    gif: 'tcp-gen8-stable-core.gif',
    ping: '@everyone',
  },
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
