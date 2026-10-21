# T.C.P. Documentation

This is the authoritative reference for T.C.P. Assistant. It describes T.C.P version 2.0 as it currently ships. If something is not in here, the assistant should say it does not know rather than guess.

## Overview

T.C.P (Tactical Competitive Pro) is a Cronus Zen script for DayZ on PlayStation and Xbox, and works with a PlayStation or Xbox controller. It is built for competitive PvP and is tuned entirely from a 26-page menu on the Zen's OLED screen (27 pages in T.C.P Premium).

It does four main jobs:

- **Anti-recoil**: pulls the aim down (and sideways) by a fixed amount while you fire, so the gun stays on target.
- **ADS Accuracy 2.0**: shapes how the right stick feels while aiming down sights.
- **Movement and utility**: Auto Run, Automatic Aim, Follow Lean, Lean Spam, Drop Shot / Crouch Shot, Auto Movement (moonwalk) and more.
- **Controller tweaks**: Hair Triggers, Deadzone and Anti Deadzone.

T.C.P Premium also has the **Weapon Workshop**: a recoil pull you record yourself for each of up to four guns (see Weapon Workshop (Premium)). Since the Gen 7 update (October 2026) Premium also runs the **Gen 7 recoil engine**, which delivers the recoil pull more intelligently (see Gen 7 Recoil Engine (Premium)), and its ADS Accuracy settings are intent-aware (see ADS Accuracy 2.0).

T.C.P cannot guarantee hits. DayZ has its own weapon sway, random recoil, server latency and stamina effects that no script can remove. It makes recoil and aiming more consistent; the player still has to aim.

### Versions

There are two ways to get T.C.P:

- **Free version** on the Cronus marketplace. It has every feature except the Weapon Workshop, and no lock.
- **T.C.P Premium**, the licensed version from the T.C.P Discord ($7 a month, or $70 a year with the **Yearly** button; subscribers become **Elite Supporters**). It has everything in the free version plus the Weapon Workshop, the Gen 7 recoil engine and the intent-aware ADS Accuracy 2.0, and needs an unlock code from the Discord (see Licence and Unlock Codes).

Where to get each one is under Downloading the script: the free version from the **Download** button in the DayZ channel, Premium in your direct messages after you **Subscribe** (or with **Download Premium**).

## Getting Started

New to T.C.P? The welcome channel has a **Start here** panel with buttons for a quick private guide: getting your licence, downloading the script, settings, getting help and the rules.

1. Get the script (see Downloading the script) and load it onto your Cronus Zen with Zen Studio.
2. T.C.P Premium only: load it on the Zen, press X (A on an Xbox controller) on the lock screen, and get your code from the licence channel (see Licence and Unlock Codes). Codes are for Elite Supporters: press **Subscribe** in the licence channel to join. The free version has no lock.
3. Open the menu with L2 + OPTIONS (LT + Menu on Xbox) and tune from there. The settings channel has setups shared by other players.

### Downloading the script

There is no separate download channel. Where you get T.C.P depends on the version:

- **Free version:** go to the DayZ channel (the one with the T.C.P for DayZ post) and press **Download**, then sign in to the GPC Library with Discord. It needs no code.
- **T.C.P Premium:** press **Subscribe** ($7 a month) or **Yearly** ($70 a year) in the licence channel. Already subscribed monthly? Press **Manage subscription** and switch to yearly there; the bot extends your licence to the end of the new year. When your payment goes through, the bot sends the Premium script to your direct messages and gives you the Elite Supporter role. No DM (your DMs are closed), lost the file, or want the newest version? Press **Download Premium** on the licence panel and it is sent to you privately.

Then add the file to Zen Studio and program it to a slot on your Cronus Zen. Asking for the file in the help channel or a ticket does not get it to you faster; use the buttons above.

## Controls

Button names in this guide are PlayStation names. See Xbox controllers below for the Xbox buttons.

### Menu controls

- **Open or close the menu**: hold L2 and press OPTIONS.
- **Change page**: LEFT and RIGHT on the D-pad.
- **Change a value**: UP and DOWN. Holding UP or DOWN repeats after a short delay.
- **Change a value faster**: hold X while pressing UP or DOWN to move in steps of 10.
- **Switch something on or off**: X.
- **Move between items on a multi-item page** (Lean Spam, Drop Shot, Auto Movement, and the Workshop in Premium): L1 and R1.
- **Save and exit**: press Circle, or close the menu with L2 + OPTIONS. Settings are saved when the menu closes.

### Xbox controllers

T.C.P works with an Xbox Series X|S or Xbox One controller plugged into the Zen. The Xbox buttons do the same jobs as the PlayStation buttons in the same place: **A** = X (Cross), **B** = Circle, **X** = Square, **Y** = Triangle, **LB/RB** = L1/R1, **LT/RT** = L2/R2, **LS/RS** (stick clicks) = L3/R3, **Menu** = OPTIONS, **View** = SHARE. The D-pad and sticks are the same.

The menu's hint line switches to Xbox names when an Xbox controller is plugged in (for example "A TOGGLE B EXIT"), and the lock screen says "PRESS A TO BEGIN".

So on Xbox: open the menu with **LT + Menu**, switch things on or off with **A**, save and exit with **B**, move between items with **LB/RB**, and hold **LS + RS** for one second for Master on/off.

One difference: the ADS profile swap (L2 + SHARE) is PlayStation only. On Xbox, View opens DayZ's inventory, so T.C.P leaves it alone; swap profiles on the ADS Profile page instead.

### Master on and off

Hold **L3 + R3** for one second to switch the whole script on or off. The controller rumbles (buzzes) once for on and twice for off. A quick L3 + R3 press still reaches the game; only a deliberate hold toggles the script. When Master is off, T.C.P does not touch the controller at all. The hold only works with the menu closed; with the menu open, switch Master on its own page (the first page, where the menu opens) with X.

### ADS profile swap

Press **L2 + SHARE** to swap between ADS profile 1 and profile 2. One rumble pulse means profile 1, two pulses mean profile 2. SHARE is kept from the game while you are holding L2. This needs Master on and a PlayStation controller; on an Xbox controller, swap on the ADS Profile page.

### Factory reset

Inside the menu, hold **L1 + R1 + X** for two seconds. Every setting goes back to its default. A licence code that has already been entered is not affected. In T.C.P Premium, your Weapon Workshop recordings are kept too, with each slot's Gun, Mag, Scale Y and Scale X; only the Weapon slot goes back to OFF.

## Menu Pages

The menu has 26 pages, in this order:

1. Master Controls (on/off)
2. Anti Recoil (on/off)
3. ADS Accuracy (on/off)
4. Auto Run (on/off)
5. Automatic Aim (on/off)
6. Follow Lean (on/off)
7. Lean Spam (four items: on/off, Fire Only, Direction, Lean Time)
8. Drop Shot (seven items: on/off, Double Tap, Drop on Fire, Stand Up After, Hold Time, Cooldown, Stance)
9. Hair Triggers (on/off)
10. Vertical Recoil
11. Horizontal Recoil
12. Turn Strength
13. Hip Fire Recoil
14. Calibrate Recoil (on/off)
15. Deadzone
16. Anti Deadzone
17. ADS Profile
18. ADS Sens
19. ADS Vertical
20. Fire Sens
21. Precision
22. Response
23. Easing
24. Steady Hold
25. Auto Movement (six items: on/off, Stop on ADS, Do 180, Left Time, Right Time, Strafe Amount)
26. Motion Intel (on/off)

T.C.P Premium adds a 27th page, **Workshop** (seven items: Weapon, Gun, Mag, Record, Scale Y, Scale X, Clear), after Motion Intel. The menu opens on Master, so LEFT once from there goes straight to it. Every other page keeps its number. The free version has no Workshop page.

### Defaults and ranges

| Setting | Range | Default |
|---|---|---|
| Vertical Recoil | 0 to 100 | 25 |
| Horizontal Recoil | -50 to 50 | 3 |
| Turn Strength | 0 to 100 | 100 |
| Hip Fire Recoil | 0 to 100 (0 = off) | 0 |
| Deadzone | 0 to 30 (0 = off) | 0 |
| Anti Deadzone | 0 to 40 (0 = off) | 0 |
| ADS Sens | 0 to 100 | 90 |
| ADS Vertical | 25 to 200 | 100 |
| Fire Sens | 20 to 100 (100 = off) | 100 |
| Precision | 0 to 100 (0 = off) | 0 |
| Response | 0 to 100 | 100 |
| Easing | 0 to 100 (0 = off) | 0 |
| Steady Hold | 0 to 5 (0 = off) | 0 |
| Lean Time | 80 to 600 ms | 200 |
| Drop Hold Time | 300 to 1500 ms | 700 |
| Drop Cooldown | 0 to 5000 ms | 1500 |
| Do 180 | -1 to 1000 ms (0 = off) | 0 |
| Left Time / Right Time | 40 to 600 ms | 180 |
| Strafe Amount | 10 to 100 | 100 |

On/off defaults: Master, Anti Recoil, ADS Accuracy, Auto Run, Automatic Aim, Follow Lean, Drop Shot, Stand Up After, Auto Movement and Stop on ADS are on. Lean Spam, Double Tap, Drop on Fire, Hair Triggers and Motion Intel are off. Lean Spam's Fire Only is on and its Direction is BOTH. Drop Shot's Stance is PRONE. Drop Shot is on, but with Double Tap and Drop on Fire both off it does nothing until you switch one of them on.

## Anti-Recoil

Anti-recoil works while you fire: R2 held together with L2 (aiming down sights). It adds a steady pull to the right stick so the gun stays on target.

### Vertical and Horizontal Recoil

- **Vertical Recoil** (default 25) is how hard the script pulls down while you fire. Higher means more pull.
- **Horizontal Recoil** (default 3) is the sideways pull. Positive pushes the aim right and negative pushes it left; set it against your gun's sideways drift (gun drifts right: lower it; drifts left: raise it).

These two are the whole recoil baseline. Despite the names, they are the script's counter-pull, not how much the gun kicks. The pull is the same for the whole burst. There are no recoil patterns or phase settings. The free version uses one Vertical/Horizontal pair for every gun; T.C.P Premium can also store a recorded pull for each gun in the Weapon Workshop (see Weapon Workshop (Premium)).

**Important:** the right Vertical value depends on your in-game aiming sensitivity. The correction is a fixed stick amount, so if you raise DayZ's own vertical aim sensitivity, the same Vertical value pulls further and you need a lower one. Always check your in-game sensitivity before tuning Vertical.

### How anti-recoil reacts to your stick

The script weakens its pull when you move the stick yourself, so it does not fight you:

- A **fast flick** weakens the pull a lot, so you can snap to a new target.
- **Steady tracking** keeps most of the pull.
- **Pulling down yourself** takes part of your pull off the script's, so the two do not add up and drag the aim low.
- Letting the stick rest near centre for a moment restores full strength (precision hold).

Turn Strength sets how much of the flick and tracking weakening applies: at 100 it applies fully, at 0 flicks and tracking never weaken the pull.

When you stop firing, the pull fades out over a fraction of a second instead of cutting off, so the aim does not jump.

In **T.C.P Premium** the Gen 7 recoil engine handles all of this (see Gen 7 Recoil Engine (Premium)): the pull lets go per axis, so tracking sideways keeps the vertical pull, it gives way faster than it comes back, and it comes off within a few hundredths of a second when you stop firing. Vertical, Horizontal and Turn Strength still mean the same thing.

### Turn Strength

Turn Strength (0 to 100, default 100) sets how much moving the right stick while you fire weakens the recoil pull. (A fast flick weakens it a lot, steady tracking a little; letting the stick rest near centre for a moment restores it.) It does not set how strong the pull is; Vertical and Horizontal do that.

- **Higher**: moving the stick weakens the pull more. Your stick takes over and recoil control drops while you move.
- **Lower**: the pull stays closer to full strength while you move the stick.

Example, for a fast flick that cuts the pull by 60% at the default:

- **Turn Strength 100** (default): the pull is cut by 60%, leaving 40% of it. Moving the stick weakens it the most.
- **Turn Strength 50**: the pull is cut by 30%, leaving 70% of it.
- **Turn Strength 0**: the pull is not cut at all. Flicks and tracking never weaken it.

Lower it (try around 40) if the gun climbs when you steer or track mid-burst. Keep 100 if the pull drags your aim down when you switch targets. Pulling down yourself still takes part of the pull off at any value, and so does Motion Intel if you turn it on.

**The name is misleading:** Turn Strength is not the strength of the recoil control. Higher Turn Strength means less recoil control while you move the stick, because your stick takes over more.

### Hip Fire Recoil

Hip Fire Recoil (default 0, off) lets anti-recoil work when you fire without aiming (R2 alone). The value is a percentage of your normal Vertical and Horizontal (or of the recorded pull, when a Weapon Workshop slot with one is selected in T.C.P Premium). Note that with it on, the script also pulls the stick whenever you press R2 without L2, including melee and driving.

### Calibrate Recoil

Calibrate Recoil sets Vertical and Horizontal for you:

1. Turn Calibrate Recoil on and close the menu.
2. Aim at a fixed point (a wall works well) and fire a burst of at least one second, holding the sights on that point with your thumb.
3. Three rumble pulses mean it has saved new Vertical and Horizontal values. They show on the home screen.

A tap or a burst shorter than one second is ignored and calibration stays armed. Run it two or three times for the best result. It measures the pull that kept the gun on target, so it only works if you actually hold the gun steady.

In T.C.P Premium, Calibrate Recoil cannot be switched on while a Weapon Workshop slot with a recorded pull is selected (the hint says PULL IN USE), because that pull replaces Vertical and Horizontal.

## Weapon Workshop (Premium)

### What the Weapon Workshop is and who has it

The Weapon Workshop is part of **T.C.P Premium**, the licensed script from the T.C.P Discord. It is not in the free marketplace version. It stores a recoil pull for each of your guns. You record it yourself on the Zen: aim at a mark on a wall and fire three full magazines. T.C.P measures the steady Vertical and Horizontal pull that gun needed and saves it in a weapon slot. While that slot is selected, T.C.P fires the recorded pull instead of your Vertical and Horizontal Recoil.

- **Four slots**, W1 to W4. Any gun can go in any slot.
- Each slot holds **one steady pull** (a Vertical and a Horizontal value) for one gun. It is not a recoil pattern: DayZ gives every shot of a magazine the same expected kick, so one steady pull is what a gun needs.
- **Weapon OFF** (the default): T.C.P fires your Vertical and Horizontal Recoil exactly as before.
- Where it is: the last menu page, **Workshop** (page 27/27). Open the menu with L2 + OPTIONS (LT + Menu) and press LEFT once.
- **Premium only.** T.C.P Premium is the licensed version from the Discord: $7 a month or $70 a year, unlocked with a code from the licence channel (see Licence and Unlock Codes). Subscribing gives you the Elite Supporter role and sends you the script in your DMs. The free marketplace version has 26 pages and no Workshop, so if you cannot find the Workshop page, check that you loaded the licensed script from the Discord, not the marketplace one, and that it is the latest copy: press **Download Premium** on the licence panel (licensed downloads from before the Workshop do not have it).
- You can use it with a PlayStation or an Xbox controller; it works the same on both. Button names here are PlayStation first, Xbox in brackets.

### Workshop: recording step by step

Before you start: Master and Anti-Recoil on, your normal in-game sensitivity and attachments, and a wall with a small mark to aim at.

1. **Open the Workshop**: L2 + OPTIONS (LT + Menu), then LEFT once. The page shows 27/27. L1/R1 (LB/RB) moves between its seven items.
2. **Weapon** (1/7): UP/DOWN to pick a slot, W1 to W4. The other six items appear once a slot is picked.
3. **Gun** (2/7): pick the gun you are holding. T.C.P uses it, with Mag, to know how long your magazine fires. The gun list: M4-A1, M16-A2, KA-M, KA-74, KAS-74U, KA-101, LAR, AUR AX, VIKHR, SVAL, VSS, BIZON, SG5-K, USG-45, LE-MAS, and OTHER for a gun that is not listed. The slots start out as W1 M4-A1, W2 KA-M, W3 LAR and W4 VIKHR. Changing the Gun sets Mag to that gun's standard magazine.
4. **Mag** (3/7): set the number of rounds in the magazine you will fire, 5 to 100 (UP/DOWN; hold X (A) to move 10 at a time). It starts at the gun's standard magazine: 30 for most guns, 20 for the LAR, SVAL and VSS, 64 for the BIZON, and 25 for the USG-45, LE-MAS and OTHER. The page shows the rounds and how long that magazine fires, for example 30 RND 2.0S. Set it to your real magazine, for example Mag 60 for a 60-round M4 magazine or Mag 20 for a 20-round KA-M magazine: T.C.P measures each spray over that time. At the standard magazine nothing changes.
5. **Record** (4/7): press X (A). Two short buzzes mean it is ARMED. Close the menu with Circle (B).
6. **Fire a full magazine**: aim with L2 (LT) first, then hold R2 (RT). Keep the crosshair on the mark with the right stick and let go when the gun stops firing. The screen shows REC and a progress bar that fills over the whole magazine.
7. **Do it three times.** Three short buzzes mean the spray counted (SPRAY 1/3, 2/3). After the first counted spray the gun already fires the up/down pull it measured, so sprays 2 and 3 should feel nearly right; reload and fire again within about 20 seconds. Three long buzzes mean COMPLETE: the pull is saved. The screen shows the pull (for example V28 H4) and how consistent your three sprays were: TIGHT, GOOD or LOOSE.

Taps and bursts shorter than one second are ignored while recording: no buzz, nothing on the screen.

### Workshop: switching slots and using a recording

- **Leave Weapon on the slot you recorded.** The home screen shows the slot and gun (for example W1 M4-A1) and a **PULL** badge: the recorded pull fires when you shoot. A **STD** badge means that slot has no pull yet, so your Vertical and Horizontal Recoil fire.
- **Change slots when you change guns**: open the Workshop and press UP/DOWN on Weapon (one short buzz per change). Slots only change in the menu, and T.C.P cannot see which gun you hold.
- **Weapon OFF** takes you back to your normal Vertical and Horizontal Recoil.
- While a slot with a pull is selected, Vertical Recoil and Horizontal Recoil are locked: UP/DOWN buzzes and the hint says PULL: SCALE Y or PULL: SCALE X. Adjust that gun with Scale Y and Scale X instead, or set Weapon OFF.

### Workshop: Scale Y and Scale X

Scale Y and Scale X (50 to 150%, default 100) adjust a recorded pull without recording again. What fires is the recorded pull times the Scale.

- **Scale Y** is the up/down strength. Gun still climbs: raise it. Aim gets pulled down: lower it.
- **Scale X** is the sideways strength.
- Change them in small steps and fire a few bursts between changes.
- Use Scale Y and Scale X for a recorded gun, not Vertical and Horizontal Recoil: those are locked while a slot with a pull is selected (the hint says PULL: SCALE Y or PULL: SCALE X).
- They only work on a slot with a pull. On an empty slot UP/DOWN buzzes and the hint says RECORD FIRST.
- Clearing a slot puts its Scale Y and Scale X back to 100.

### Workshop: redo, clear and the four slots

- **Redo**: on a slot that already has a pull, the Record item shows REDO with the consistency (for example GOOD +-1.8). Arm it and record three sprays again; the new pull replaces the old one when the session completes. Redo after you change your in-game sensitivity or your attachments.
- **REDO ONCE**: if you see this on the Record item or the COMPLETE screen, record that slot one more time (a REDO). It means the session started far from what the gun needed (often a gun that kicks much harder or softer than your Vertical Recoil, or the short SVAL and VSS magazines), so one more recording should make the pull more accurate.
- **Clear**: go to Clear (7/7) and hold X (A) for one second until the bar fills. Four short buzzes mean it is cleared, Scale Y and Scale X go back to 100, and Mag goes back to the gun's standard magazine. On an empty slot X gives one long buzz and the hint says NOTHING TO CLEAR.
- **Four slots, any guns.** The same gun in two slots is fine, for example with different attachments, optics or magazines (set each slot's Mag).
- Recordings are saved through power-off. A factory reset (L1 + R1 + X in the menu) keeps your recordings, guns, Mag and scales; it only sets Weapon back to OFF.
- **The update that added Mag empties the Workshop once.** The way slots are saved changed, so the first start of the new Premium script shows every slot empty and Weapon OFF. Record your guns again; your other settings are kept.

### Workshop messages

What the recorder card or the Workshop page says, and the fix:

- **The card's big label** says what the recorder is doing: **ARMED** (waiting for a spray; AIM AT MARK, or REPLACES on a slot that already has a pull, and FIRE A MAG; if Drop on Fire or Lean Spam is switched on, a pause mark with DROP, LEAN or DROP+LEAN shows they are paused), **REC** (measuring a spray; KEEP AIMING, UNTIL EMPTY; the bar fills over the whole magazine Mag is set to), **ACCEPTED** (the spray counted: SPRAY 1/3 or 2/3 and that spray's pull), **DISCARDED** (the spray was thrown out; the lines under it say why, see the list below), **COMPLETE** (pull saved) and **STOPPED** (nothing saved). On the Workshop page, Mag shows the rounds and how long they fire (for example 30 RND 2.0S), Record shows READY on an empty slot, Weapon shows STD V/H when your Vertical and Horizontal fire (no pull), and Clear shows EMPTY once a slot has no pull.
- **TOO SHORT / FULL MAG**: the spray was too short to measure. Fire a full magazine, and check that Mag is set to the rounds in your magazine (a 20-round magazine with Mag at 30 runs dry too soon).
- **TOO SHORT / HOLD LONGER**: you let go too soon after the last shot. Keep holding R2 (RT) for a moment after the gun stops (mostly the SVAL and VSS, or a very short magazine).
- **TOO SHORT / 20+ RND MAG** (VSS): the spray was too short, usually because of the VSS's own 10-round magazine. Use a 20- or 30-round magazine (Mag 20 or 30). With the 10-round magazine, set Mag to 10 and keep holding R2 (RT) on the mark for about a second after the last shot.
- **HOLD LONGER / 20+ RND MAG** (VSS): you let go too soon after the last shot. Hold R2 (RT) a moment after the gun stops (about a second with the 10-round magazine at Mag 10), or record with a 20- or 30-round magazine.
- **STICK MOVED / FIRE AGAIN**: the stick moved too much (tracking sideways or a big sweep). Hold the mark steady and fire again. If it keeps happening on an empty slot while you hold still, the gun needs more sideways pull than your Horizontal Recoil: set Horizontal closer first.
- **STICK MOVED / VERTICAL UP**: you had to pull the stick far down to hold the mark, so the gun needs more than your Vertical Recoil gives. Raise Vertical Recoil and record again. **SCALE Y UP** is the same when re-recording a slot with a pull: raise Scale Y.
- **OFF PATTERN**: this spray did not match your first one closely enough. Fire again the same way: full magazine, steady on the mark.
- **AIM FIRST**: you pulled R2 (RT) before L2 (LT). Aim down sights (ADS) first, then fire.
- **AIM LOST**: you let go of L2 (LT) early in the spray (within its first second) while still holding R2 (RT). Keep aiming down sights (ADS) until the gun stops.
- **CANCELLED**: you opened the menu during a spray. The recorder is still armed; fire again. It does not buzz and does not count toward stopping the session.
- **STOPPED / NOT SAVED**: the session stopped and nothing was saved, after too many thrown-out sprays (two STICK MOVED, or three thrown out for any reason except CANCELLED, without a counted spray in between) or 90 seconds without a counted spray (TIMED OUT). Arm Record again.
- **PULL: SCALE Y / PULL: SCALE X** (Vertical or Horizontal Recoil page): locked while a pull fires. Use Scale Y or Scale X, or set Weapon OFF.
- **PULL IN USE** (Calibrate Recoil page): Calibrate is not available while a pull fires.
- **RECORD FIRST** (Scale Y or Scale X): the slot has no pull yet. Record it first.
- **MASTER IS OFF** (Record): Master is off. Press RIGHT once to go to the Master page (it wraps round from the Workshop), press X (A) to turn it on, then LEFT once back to the Workshop and arm again. Or close the menu, hold L3 + R3 (LS + RS) for one second, and come back; the hold does nothing while the menu is open.
- **ANTI RECOIL OFF** (Record): Anti-Recoil is switched off, so nothing can be recorded. Turn it on on the Anti-Recoil page (page 2) and arm again.
- **NOTHING TO CLEAR** (Clear): the slot is already empty.
- **REDO ONCE**: one more recording of this slot should make it more accurate. Do one REDO.

### Workshop buzzes

The controller rumbles to tell you what the recorder is doing:

- **2 short**: recorder armed.
- **1 short**: during a spray, it has lasted long enough to count. Otherwise: you stopped the session, or changed something that ends it (nothing saved), or changed slot.
- **3 short**: spray counted.
- **3 long**: session complete, pull saved.
- **1 long**: spray thrown out (the screen says why; only the first in a row buzzes, and CANCELLED never does), or something is not allowed, for example X on Record with Master off.
- **2 long**: session stopped, nothing saved.
- **4 short**: slot cleared.

### Workshop: notes on recording

- While the recorder is armed, Drop on Fire and Lean Spam pause (going prone or leaning moves your view). They work again when the session ends.
- Opening the menu during a spray cancels that spray (CANCELLED); the recorder stays armed.
- These end a recording and save nothing (one short buzz): X (A) on Record again, changing the Weapon slot, the Gun, the Mag, Vertical or Horizontal Recoil, Scale Y or Scale X, Anti Deadzone, switching Anti-Recoil off, or switching on Calibrate Recoil. Clear and Master off end it too.
- Before recording an empty slot, set Vertical Recoil roughly right for that gun. A gun far stronger than your Vertical can end in STICK MOVED / VERTICAL UP.
- Set Mag to the magazine you fire. At the wrong Mag a big magazine is only partly measured, and a small one runs dry before the window ends (TOO SHORT / FULL MAG if you let go as it empties).
- A very short magazine (about 15 rounds or fewer on a fast gun such as the M4-A1) still records: keep holding R2 (RT) on the mark until about 1.5 seconds after you started firing.
- VSS: record with a 20- or 30-round magazine (Mag 20 or 30). With its own 10-round magazine, set Mag to 10 and keep holding R2 (RT) for about a second after the last shot; the card says 20+ RND MAG either way. SVAL and VSS: hold R2 (RT) a moment after the last shot.
- The recording measures what the game received from T.C.P and your thumb together, so hold the mark as steadily as you can.
- Changing your in-game sensitivity or attachments changes what a gun needs: REDO that slot. Changing Anti Deadzone makes every recorded pull reach the game stronger or weaker: REDO the slots, or adjust their Scale Y and Scale X.

## Gen 7 Recoil Engine (Premium)

### What Gen 7 is

Gen 7 is how **T.C.P Premium** delivers the recoil pull since the October 2026 update. It does not change how strong the pull is: Vertical and Horizontal (or a recorded Workshop pull) are still the baseline, and Gen 7 never adds power. It changes **how** that pull is delivered while you move the stick:

- **Per axis**: when you track sideways, only the sideways pull gives way; the vertical pull keeps holding the gun down. When you correct up or down, the sideways pull is left alone.
- **Your stick wins, fast**: a flick, snap, turn or direction reversal lets the pull go within a few hundredths of a second, and it comes back slowly as your thumb settles, so the script never fights a deliberate move.
- **A steady hold locks in**: hold the aim still and the full pull settles on it.
- **Clean release**: when you stop firing the pull comes off almost at once, so single shots and short bursts do not nudge the aim.
- **Re-pulls feel continuous**: fire again within a tenth of a second and the pull picks up where it left off.

There is nothing to set up. The free version uses the earlier Stable Core delivery, which works the same way at a fixed rate on both axes together.

### Gen 7 and your settings

- **Vertical and Horizontal** set the pull's size, exactly as before. Tune them the same way (or record a Workshop pull).
- **Turn Strength** still sets how much moving the stick weakens the pull: 100 is the full effect, 0 means your stick never weakens it.
- **Motion Intel** makes no difference in Premium: with Gen 7 running, on or off feel the same. Leave it off.
- **Anti Deadzone** still lifts the pull as before.

### Gen 7 tuning tips

- The gun climbs while you correct up or down: raise Vertical a little, as before.
- The gun feels like it lets go when you make small sideways adjustments: that is the engine giving way to your thumb; keep the adjustment smooth and it holds. Lowering Turn Strength keeps more of the pull while you move.
- Groups feel tighter while tracking than while standing still: that is expected. Tracking sideways no longer weakens the vertical pull.

## ADS Accuracy 2.0

ADS Accuracy shapes the right stick while you hold L2. With every setting at its default (Precision 0, Easing 0, Steady Hold 0, Response 100, Fire Sens 100, ADS Vertical 100), the aim is simply your stick times ADS Sens. Change one setting at a time.

In **T.C.P Premium** (since the Gen 7 update) Precision, Response and Easing are **intent-aware**: behind the same four settings the script reads how you are moving the stick (a tiny correction, a smooth track, a fast correction, a snap, a turn, a reversal) and applies each setting where it helps. Small movements get the precision, smooth tracking stays natural, corrections stay fast, reversals are immediate and turns pass straight through. **ADS Sens is never changed by it**: Precision in Premium does not slow the stick. The free version keeps the behaviour described in each section below under "Free version".

### ADS Sens

ADS Sens (default 90) is your overall aiming speed while aiming down sights, as a percentage of the stick. Lower is slower.

### ADS Vertical

ADS Vertical (25 to 200, default 100) changes only the up/down aiming speed. Above 100 makes vertical faster, below 100 slower. Use it to balance the two axes inside the script instead of changing DayZ's own sensitivity (which would also mean retuning Vertical Recoil).

### Fire Sens

Fire Sens (20 to 100, default 100 = off) is your aiming speed while shooting, as a percentage of normal. At 75 the stick is 25% slower during a burst, which makes small corrections steadier. It eases in when you pull R2 and back out when you release, so there is no sudden jump.

### Precision

**Premium:** Precision (default 0 = off) sets how steady tiny aiming movements are. It smooths small, controlled stick movements near the centre (within about 15% of the stick) so fine adjustments land cleanly, and it fades out as you move further or faster, so it never slows a track, a correction or a turn. It does not reduce sensitivity: a stick held at 20 still reads 20. At 100 the micro-aim smoothing is about 30 ms. Values of 30 to 60 are typical for long-range aiming; 0 is the raw stick.

**Free version:** Precision slows the stick near the centre for fine aiming, then smoothly returns to full speed further out. At 100 the centre is 40% slower. Values of 20 to 40 are typical.

### Easing

Easing (default 0 = off) smooths the stick so small jerks in your thumb are rounded off. More Easing is smoother but adds delay:

- Easing 10: about 20 ms to catch up.
- Easing 25: about 40 ms.
- Easing 50: about 80 ms, noticeable lag.
- Easing 100: about 156 ms, very floaty.

Most players use 8 to 20.

**Premium:** the Easing you set is the most that ever applies. The script reduces it as you move: about 80% of it for small controlled aiming, 40% while tracking, 15% during a fast correction, and none at all during a snap, a turn or a reversal, and it drops it further the more energetically you move or when you strafe hard. It comes back gradually once your thumb settles, so a correction is never followed by a sudden lag.

### Response

Response (default 100) decides when Easing is skipped. Fast flicks skip the smoothing so they stay instant. At 100 almost any quick movement skips it; at 0 almost nothing does. Lowering Response does not make aiming slower; it makes more of your movement get smoothed. Response only matters when Easing is above 0.

**Premium:** Response is raised by itself when you track (+5) or correct fast (+10), goes to 100 during a snap, a turn or a reversal, and rises a little while you strafe. Your setting is the starting point for calm aiming.

### Steady Hold

Steady Hold (0 to 5, default 0 = off) absorbs thumb tremor. The aim only moves once your stick has moved more than this many units, so tiny shakes are ignored. It only works near the centre of the stick and fades out further out. 1 or 2 is usually enough.

### ADS Profiles

There are two ADS profiles. Each stores its own ADS Sens, Precision, Response, Easing and Steady Hold. Switch on the ADS Profile page, or with L2 + SHARE on a PlayStation controller. A common setup is one profile for close range and one for long range.

## Movement and Utility

### Auto Run

Auto Run (default on) holds sprint for you. Push the left stick forward past about a quarter and the script holds full forward and sprint. It turns off while you aim (L2) and while Auto Movement is running.

### Automatic Aim

Automatic Aim (default on) presses R3 briefly when you first pull L2, to bring the sights up. It is skipped if you are holding L3.

### Follow Lean

Follow Lean (default on) leans for you while aiming. After a short delay, moving the left stick left or right past about 20% presses L1 or R1 to lean that way.

### Lean Spam

Lean Spam (default off) makes you lean left and right repeatedly in a fight, so your head is a moving target and harder to hit.

- **Fire Only** (default on): only while you aim and fire. Off: the whole time you aim.
- **Direction**: BOTH swaps left and right; LEFT or RIGHT leans that way and back to upright, for using one side of cover.
- **Lean Time** (default 200 ms): how long each lean lasts.

Holding L1 or R1 yourself pauses it. Leaning also moves your own sights, so if your aim feels shaky with it on, raise Lean Time to around 300 for a slower sway.

### Drop Shot and Crouch Shot

Drop Shot changes your stance during a fight. It has two triggers, Double Tap and Drop on Fire. Both are off by default, so Drop Shot does nothing until you switch one of them on.

- **Double Tap** (default off): two Circle presses within 280 ms drop you prone. It is off by default because a quick Circle double tap in DayZ is crouch then stand, which players do on purpose. With it off, your Circle presses reach the game untouched.
- **Drop on Fire** (default off): drops the moment you aim and fire together.
- **Stance** (default PRONE): PRONE goes prone; CROUCH crouches instead (a crouch shot). Stance only affects Drop on Fire; the double tap always goes prone.
- **Stand Up After** (default on): after a drop on fire, stands you back up when you let go of L2, or when you have stopped firing for 0.4 seconds.
- **Hold Time** (default 700 ms): how long Circle is held to go prone. Raise it if the game crouches you instead.
- **Cooldown** (default 1500 ms): stops it dropping you again straight after a drop or stand-up.

Crouch Shot assumes a quick Circle tap crouches in your DayZ setup.

### Auto Movement (moonwalk)

Auto Movement runs you forward while strafing left and right in a rhythm. Hold **D-pad Down** briefly to start or stop it.

- **Do 180**: before strafing starts, spins your view about 180 degrees by holding the right stick for this many milliseconds. 0 is off. The right value depends on your look sensitivity; start around 200 to 300 and adjust until the turn lands on 180.
- **Left Time / Right Time** (default 180 ms each): how long each strafe lasts. Set them unevenly if the game needs it.
- **Strafe Amount** (default 100): how far sideways the stick goes. This decides whether DayZ holds the moonwalk animation; try around 55 to 60 if it keeps dropping out.
- **Stop on ADS** (default on): stops when you aim. Pulling the left stick back also stops it.

### Hair Triggers

Hair Triggers (default off) make L2 and R2 count as fully pressed as soon as you pull them about 20% of the way, for faster aiming and firing.

### Deadzone

Deadzone (0 to 30, default 0 = off) ignores small right-stick movements near the centre. Raise it until a resting stick no longer moves your aim (stick drift).

### Anti Deadzone

Anti Deadzone (0 to 40, default 0 = off) skips over DayZ's own deadzone, so small stick movements register instead of doing nothing and then jumping. Raise it until the aim starts creeping on its own, then go back one step. It also strengthens the recoil pull, so retune Vertical and Horizontal after changing it (for a recorded Weapon Workshop slot, Scale Y and Scale X, or a REDO).

### Motion Intel

Motion Intel (default off) watches how you move the stick and can weaken the recoil pull further during fast movement, on top of Turn Strength. It only ever weakens the pull (less recoil control), never strengthens it. Most players should leave it off. In **T.C.P Premium** it makes no difference at all: the Gen 7 engine already reads the stick, and on or off feel the same.

## Tuning Guide

Always change one setting at a time, in small steps, and test a few bursts between changes.

### Before you tune: check in-game sensitivity

Most "it feels wrong" problems start with DayZ's own controller sensitivity, not the script. If your in-game vertical and horizontal aiming sensitivities are very different (for example vertical 1 and horizontal 5), aiming will feel uneven no matter what the script is set to. Bring them closer together first. If you change in-game vertical sensitivity, retune Vertical Recoil afterwards (in T.C.P Premium, also REDO any Weapon Workshop slot you have recorded).

### Gun climbs during a burst

Vertical Recoil is too low. Raise it 1 or 2 at a time. Or run Calibrate Recoil. If it only climbs while you move the stick (tracking or steering), lower Turn Strength instead. With a recorded pull selected in the Weapon Workshop (Premium), Vertical Recoil is locked: raise Scale Y instead.

### Aim gets pulled down / sinks

Vertical Recoil is too high. Lower it 1 or 2 at a time. If it only sinks while you pull down yourself, that is normal behaviour and you do not need to pull as hard. If it only drags down when switching targets (flicking to a new target) and you have lowered Turn Strength, raise Turn Strength back toward 100. With a recorded pull selected in the Weapon Workshop (Premium), lower Scale Y instead.

### Gun drifts left or right

If the gun drifts right, lower Horizontal Recoil a little (toward negative); if it drifts left, raise it. Small changes; values of 0 to 5 are common. DayZ recoil also has a random sideways part no script can cancel. With a recorded pull selected in the Weapon Workshop (Premium), Horizontal Recoil is locked: adjust Scale X instead, which makes the recorded sideways pull (the H on the home screen) stronger or weaker, or REDO that slot.

### Hard to stay on target while shooting

Check in-game sensitivity first. If the gun climbs when you steer or track mid-burst, lower Turn Strength (around 40) so moving the stick weakens the pull less (in Premium, tracking sideways already keeps the vertical pull; lower Turn Strength if it still climbs while you correct). For steadier small corrections, lower Fire Sens to around 75, add a little Easing (10 to 15), or in Premium raise Precision (30 to 60).

### Aim feels too fast or overshoots

Lower ADS Sens a little. In the free version, Precision (20 to 40) also slows the centre for finer control; in Premium, Precision steadies small movements instead of slowing them, so use ADS Sens for speed and Precision (30 to 60) for steadiness.

### Aim feels laggy or floaty

Easing is too high. Lower it. Also check Steady Hold is 0 to 2.

### Small movements do nothing, then the aim jumps

DayZ's deadzone is swallowing small movements. Raise Anti Deadzone a little, then retune Vertical and Horizontal (for a recorded Weapon Workshop slot, Scale Y and Scale X, or a REDO).

### Aim moves when the stick is at rest

Stick drift. Raise Deadzone until it stops. If you use Anti Deadzone, lower it, because too much causes creeping.

## Troubleshooting

### Nothing happens / the script does nothing

Master may be off. Hold L3 + R3 for one second (one rumble pulse = on). Also check the feature's own page is on.

### The menu will not open

Hold L2, then press OPTIONS (on Xbox: hold LT, then press Menu). The menu opens and closes the same way.

### Settings are not saving

Settings save when the menu closes. Close it with Circle (B on Xbox) or L2 + OPTIONS before turning the controller off.

### Reporting a bug

Use the **Report a bug** button in the bug report channel. Pick the feature and your build, then describe what happened, what you expected, the steps that make it happen, and your script version and settings. You get a direct message when the status of your report changes (Investigating, Fixed or Can't reproduce).

### Headset audio cuts out

Drawing busy animations on the Zen's screen can briefly interrupt audio passing through it. The home screen is kept nearly static for this reason. If audio cuts while the menu is open, close the menu.

## Licence and Unlock Codes

The licensed version from the Discord (T.C.P Premium) is locked until it is unlocked with a code. The free marketplace version has no lock.

### How to unlock

1. Load the script. The screen shows "T.C.P LOCKED" and "PRESS X TO BEGIN".
2. Press X. The screen shows your five-digit number. It stays the same until you unlock.
3. In the Discord licence channel, press **Generate** and type your number.
4. The bot replies privately with a six-digit code.
5. On the Zen, use UP/DOWN to change a digit, LEFT/RIGHT to move between digits, and X to confirm.

One rumble pulse means it unlocked. "WRONG CODE" with two pulses means the code does not match; check the number and digits.

### Free trial

There is no free trial. Unlock codes are only for **Elite Supporters**. Press **Subscribe** on the licence panel to join: your payment gives you the Elite Supporter role, sends you the Premium script in your DMs and adds your days, and you can press **Generate** straight away.

### Why it asks for a new code

A code lasts a set number of power-ups of the script, based on the days left on your subscription:

| Days left | Power-ups |
|---|---|
| 63 or more | 400 |
| 34 to 62 | 200 |
| 16 to 33 | 80 |
| 8 to 15 | 50 |
| 1 to 7 | 20 |

When they run out, the Zen locks again with a new number and "RENEW IN DISCORD". Press Generate again. A new script release can also ask everyone for a fresh code.

### Checking your days left

Press **My licence** on the licence panel to see, privately, how many days you have left, when your subscription ends, how many power-ups a new code would last, and how many codes you have generated today.

### Expiry reminders

If your subscription does not renew by itself, the bot sends you a direct message three days before your access ends, and again on its last day. If you have direct messages from server members turned off, the reminder cannot reach you, so check **My licence** instead.

### Problems getting a code

- **"Elite Supporters only"**: codes are only for members with the Elite Supporter role. Press **Subscribe** on the licence panel to join; the role comes with your first payment. If you have paid and still see this, open a support ticket.
- **"Your T.C.P Premium days have run out"**: press **Subscribe** on the licence panel to renew.
- **"Generated codes in the last day ... limit"**: a member can get a code for one new number per day. Asking again for the same number does not count.
- **Code not working**: make sure the number typed into Discord is exactly the one on the Zen, and re-enter the code carefully.

## Getting Help on Discord

### Asking the assistant

Post your question in the help channel; no @mention is needed. The assistant starts a thread for each question and answers there, and you keep the conversation going by replying in that thread. Include your controller, your DayZ in-game aiming sensitivity and your T.C.P values for a faster answer. Press **Solved** when it is sorted, or **Still stuck? Open a ticket** if it is not. To keep the channel tidy, a solved thread is cleared away 5 minutes later, and a thread with no messages for a day is cleared away too; ask again any time. You can also @mention the assistant anywhere, or use the /tcp ask command.

### Opening a support ticket

Press a button on the ticket panel (or **Still stuck** under a help answer) and pick a type: **Licence & codes**, **Setup & tuning**, **Bug report** or **Payment & other**. Fill in the short form and you get a private ticket channel that only you and the owner can see. For setup and bug tickets the assistant takes a first look; press **Call the owner** if you need them. Licence and payment tickets go straight to the owner. Each member can have one open ticket at a time. Press **Close ticket** when you are done: you get a copy of the conversation by direct message.

### The Get started button

New members: press **Get started** in the welcome channel. Pick your controller (PlayStation or Xbox) and say whether you have T.C.P on your Zen yet, and you get a checklist with the right button names and links, plus a PlayStation or Xbox role.

## Limits

- T.C.P cannot remove DayZ's random recoil, weapon sway, stamina effects, latency or desync.
- There are no recoil patterns or phases. The free version uses one Vertical/Horizontal pair for every gun, and different guns may need different values. T.C.P Premium can store a recorded pull for up to four guns in the Weapon Workshop.
- The script cannot see your stance or which gun you hold. In the Workshop you pick the slot yourself.
- With Hip Fire Recoil above 0, R2 alone also pulls the stick, including melee and driving.
- Results depend on DayZ's own controller sensitivity settings.
