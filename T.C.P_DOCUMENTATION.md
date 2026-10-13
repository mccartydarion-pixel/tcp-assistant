# T.C.P. Documentation

This is the authoritative reference for T.C.P. Assistant. It describes T.C.P version 2.0 as it currently ships. If something is not in here, the assistant should say it does not know rather than guess.

## Overview

T.C.P (Tactical Competitive Pro) is a Cronus Zen script for DayZ on PlayStation and Xbox, and works with a PlayStation or Xbox controller. It is built for competitive PvP and is tuned entirely from a 26-page menu on the Zen's OLED screen.

It does four main jobs:

- **Anti-recoil**: pulls the aim down (and sideways) by a fixed amount while you fire, so the gun stays on target.
- **ADS Accuracy 2.0**: shapes how the right stick feels while aiming down sights.
- **Movement and utility**: Auto Run, Automatic Aim, Follow Lean, Lean Spam, Drop Shot / Crouch Shot, Auto Movement (moonwalk) and more.
- **Controller tweaks**: Hair Triggers, Deadzone and Anti Deadzone.

T.C.P cannot guarantee hits. DayZ has its own weapon sway, random recoil, server latency and stamina effects that no script can remove. It makes recoil and aiming more consistent; the player still has to aim.

### Versions

There are two ways to get T.C.P:

- **Free version** on the Cronus marketplace. It has every feature and no lock.
- **Licensed version** from the T.C.P Discord. It has the same features and needs an unlock code from the Discord (see Licence and Unlock Codes).

## Getting Started

New to T.C.P? The welcome channel has a **Start here** panel with buttons for a quick private guide: getting your licence, downloading the script, settings, getting help and the rules.

1. Download the script from the download channel and load it onto your Cronus Zen with Zen Studio.
2. Load it on the Zen, press X (A on an Xbox controller) on the lock screen, and get your code from the licence channel (see Licence and Unlock Codes). New members get a free 14-day trial.
3. Open the menu with L2 + OPTIONS (LT + Menu on Xbox) and tune from there. The settings channel has setups shared by other players.

## Controls

Button names in this guide are PlayStation names. See Xbox controllers below for the Xbox buttons.

### Menu controls

- **Open or close the menu**: hold L2 and press OPTIONS.
- **Change page**: LEFT and RIGHT on the D-pad.
- **Change a value**: UP and DOWN. Holding UP or DOWN repeats after a short delay.
- **Change a value faster**: hold X while pressing UP or DOWN to move in steps of 10.
- **Switch something on or off**: X.
- **Move between items on a multi-item page** (Lean Spam, Drop Shot, Auto Movement): L1 and R1.
- **Save and exit**: press Circle, or close the menu with L2 + OPTIONS. Settings are saved when the menu closes.

### Xbox controllers

T.C.P works with an Xbox Series X|S or Xbox One controller plugged into the Zen. The Xbox buttons do the same jobs as the PlayStation buttons in the same place: **A** = X (Cross), **B** = Circle, **X** = Square, **Y** = Triangle, **LB/RB** = L1/R1, **LT/RT** = L2/R2, **LS/RS** (stick clicks) = L3/R3, **Menu** = OPTIONS, **View** = SHARE. The D-pad and sticks are the same.

The menu's hint line switches to Xbox names when an Xbox controller is plugged in (for example "A TOGGLE B EXIT"), and the lock screen says "PRESS A TO BEGIN".

So on Xbox: open the menu with **LT + Menu**, switch things on or off with **A**, save and exit with **B**, move between items with **LB/RB**, and hold **LS + RS** for one second for Master on/off.

One difference: the ADS profile swap (L2 + SHARE) is PlayStation only. On Xbox, View opens DayZ's inventory, so T.C.P leaves it alone; swap profiles on the ADS Profile page instead.

### Master on and off

Hold **L3 + R3** for one second to switch the whole script on or off. The controller rumbles once for on and twice for off. A quick L3 + R3 press still reaches the game; only a deliberate hold toggles the script. When Master is off, T.C.P does not touch the controller at all.

### ADS profile swap

Press **L2 + SHARE** to swap between ADS profile 1 and profile 2. One rumble pulse means profile 1, two pulses mean profile 2. SHARE is kept from the game while you are holding L2. This needs Master on and a PlayStation controller; on an Xbox controller, swap on the ADS Profile page.

### Factory reset

Inside the menu, hold **L1 + R1 + X** for two seconds. Every setting goes back to its default. A licence code that has already been entered is not affected.

## Menu Pages

The menu has 26 pages, in this order:

1. Master Controls (on/off)
2. Anti Recoil (on/off)
3. ADS Accuracy (on/off)
4. Auto Run (on/off)
5. Automatic Aim (on/off)
6. Follow Lean (on/off)
7. Lean Spam (four items: on/off, Fire Only, Direction, Lean Time)
8. Drop Shot (six items: on/off, Drop on Fire, Stand Up After, Hold Time, Cooldown, Stance)
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

On/off defaults: Master, Anti Recoil, ADS Accuracy, Auto Run, Automatic Aim, Follow Lean, Drop Shot, Stand Up After, Auto Movement and Stop on ADS are on. Lean Spam, Drop on Fire, Hair Triggers and Motion Intel are off. Lean Spam's Fire Only is on and its Direction is BOTH. Drop Shot's Stance is PRONE.

## Anti-Recoil

Anti-recoil works while you fire: R2 held together with L2 (aiming down sights). It adds a steady pull to the right stick so the gun stays on target.

### Vertical and Horizontal Recoil

- **Vertical Recoil** (default 25) is how hard the script pulls down while you fire. Higher means more pull.
- **Horizontal Recoil** (default 3) is the sideways pull. Positive pulls one way and negative the other; set it to cancel your gun's sideways drift.

These two are the whole recoil baseline. The pull is the same for the whole burst. There are no weapon profiles, recoil patterns or phase settings in the current version.

**Important:** the right Vertical value depends on your in-game aiming sensitivity. The correction is a fixed stick amount, so if you raise DayZ's own vertical aim sensitivity, the same Vertical value pulls further and you need a lower one. Always check your in-game sensitivity before tuning Vertical.

### How anti-recoil reacts to your stick

The script backs off when you move the stick yourself, so it does not fight you:

- A **fast flick** reduces the pull a lot, so you can snap to a new target.
- **Steady tracking** keeps most of the pull.
- **Pulling down yourself** takes part of your pull off the script's, so the two do not add up and drag the aim low.
- Holding the stick nearly still for a moment restores full strength (precision hold).

When you stop firing, the pull fades out over a fraction of a second instead of cutting off, so the aim does not jump.

### Turn Strength

Turn Strength (0 to 100, default 100) controls how much your own stick movement reduces the recoil pull. At 100 the script backs off fully when you move the stick. At 0 it never backs off. If the gun kicks every time you steer during a burst, try lowering Turn Strength to around 40.

### Hip Fire Recoil

Hip Fire Recoil (default 0, off) lets anti-recoil work when you fire without aiming (R2 alone). The value is a percentage of your normal Vertical and Horizontal. Note that with it on, the script also pulls the stick whenever you press R2 without L2, including melee and driving.

### Calibrate Recoil

Calibrate Recoil sets Vertical and Horizontal for you:

1. Turn Calibrate Recoil on and close the menu.
2. Aim at a fixed point (a wall works well) and fire a burst of at least one second, holding the sights on that point with your thumb.
3. Three rumble pulses mean it has saved new Vertical and Horizontal values. They show on the home screen.

A tap or a burst shorter than one second is ignored and calibration stays armed. Run it two or three times for the best result. It measures the pull that kept the gun on target, so it only works if you actually hold the gun steady.

## ADS Accuracy 2.0

ADS Accuracy shapes the right stick while you hold L2. With every setting at its default (Precision 0, Easing 0, Steady Hold 0, Response 100, Fire Sens 100, ADS Vertical 100), the aim is simply your stick times ADS Sens. Change one setting at a time.

### ADS Sens

ADS Sens (default 90) is your overall aiming speed while aiming down sights, as a percentage of the stick. Lower is slower.

### ADS Vertical

ADS Vertical (25 to 200, default 100) changes only the up/down aiming speed. Above 100 makes vertical faster, below 100 slower. Use it to balance the two axes inside the script instead of changing DayZ's own sensitivity (which would also mean retuning Vertical Recoil).

### Fire Sens

Fire Sens (20 to 100, default 100 = off) is your aiming speed while shooting, as a percentage of normal. At 75 the stick is 25% slower during a burst, which makes small corrections steadier. It eases in when you pull R2 and back out when you release, so there is no sudden jump.

### Precision

Precision (default 0 = off) slows the stick near the centre for fine aiming, then smoothly returns to full speed further out. At 100 the centre is 40% slower. Good for long-range shots. Values of 20 to 40 are typical.

### Easing

Easing (default 0 = off) smooths the stick so small jerks in your thumb are rounded off. More Easing is smoother but adds delay:

- Easing 10: about 20 ms to catch up.
- Easing 25: about 40 ms.
- Easing 50: about 80 ms, noticeable lag.
- Easing 100: about 156 ms, very floaty.

Most players use 8 to 20.

### Response

Response (default 100) decides when Easing is skipped. Fast flicks skip the smoothing so they stay instant. At 100 almost any quick movement skips it; at 0 almost nothing does. Lowering Response does not make aiming slower; it makes more of your movement get smoothed. Response only matters when Easing is above 0.

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

Drop Shot changes your stance during a fight.

- **Double tap Circle** (within about a quarter second) to go prone. Always available while Drop Shot is on.
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

Anti Deadzone (0 to 40, default 0 = off) skips over DayZ's own deadzone, so small stick movements register instead of doing nothing and then jumping. Raise it until the aim starts creeping on its own, then go back one step. It also strengthens the recoil pull, so retune Vertical and Horizontal after changing it.

### Motion Intel

Motion Intel (default off) watches how you move the stick and can reduce anti-recoil further during fast movement. It can only reduce the recoil pull, never increase it. Most players should leave it off.

## Tuning Guide

Always change one setting at a time, in small steps, and test a few bursts between changes.

### Before you tune: check in-game sensitivity

Most "it feels wrong" problems start with DayZ's own controller sensitivity, not the script. If your in-game vertical and horizontal aiming sensitivities are very different (for example vertical 1 and horizontal 5), aiming will feel uneven no matter what the script is set to. Bring them closer together first. If you change in-game vertical sensitivity, retune Vertical Recoil afterwards.

### Gun climbs during a burst

Vertical Recoil is too low. Raise it 1 or 2 at a time. Or run Calibrate Recoil.

### Aim gets pulled down / sinks

Vertical Recoil is too high. Lower it 1 or 2 at a time. If it only sinks while you pull down yourself, that is normal behaviour and you do not need to pull as hard.

### Gun drifts left or right

Adjust Horizontal Recoil a little toward the side that cancels the drift. Small changes; values of 0 to 5 are common. DayZ recoil also has a random sideways part no script can cancel.

### Hard to stay on target while shooting

Check in-game sensitivity first. Then try lowering Turn Strength (around 40), adding a little Fire Sens (around 75) or Easing (10 to 15).

### Aim feels too fast or overshoots

Lower ADS Sens a little, or add Precision (20 to 40) for finer control near the centre.

### Aim feels laggy or floaty

Easing is too high. Lower it. Also check Steady Hold is 0 to 2.

### Small movements do nothing, then the aim jumps

DayZ's deadzone is swallowing small movements. Raise Anti Deadzone a little, then retune Vertical and Horizontal.

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

The licensed version from the Discord is locked until it is unlocked with a code. The free marketplace version has no lock.

### How to unlock

1. Load the script. The screen shows "T.C.P LOCKED" and "PRESS X TO BEGIN".
2. Press X. The screen shows your five-digit number. It stays the same until you unlock.
3. In the Discord licence channel, press **Generate** and type your number.
4. The bot replies privately with a six-digit code.
5. On the Zen, use UP/DOWN to change a digit, LEFT/RIGHT to move between digits, and X to confirm.

One rumble pulse means it unlocked. "WRONG CODE" with two pulses means the code does not match; check the number and digits.

### Free trial

New members get a free 14-day trial automatically the first time they press Generate. The trial is once per member.

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

The bot sends you a direct message three days before your trial or subscription ends, and again on its last day. If you have direct messages from server members turned off, the reminder cannot reach you, so check **My licence** instead.

### Problems getting a code

- **"Your trial or subscription has ended"**: the subscription has expired. Open a support ticket to renew.
- **"Generated codes in the last day ... limit"**: a member can generate codes for up to three new numbers per day. Asking again for the same number does not count.
- **Code does not work**: make sure the number typed into Discord is exactly the one on the Zen, and re-enter the code carefully.

## Limits

- T.C.P cannot remove DayZ's random recoil, weapon sway, stamina effects, latency or desync.
- One Vertical/Horizontal pair is used for every gun; there are no weapon profiles. Different guns may need different values.
- The script cannot see your stance or which gun you hold.
- With Hip Fire Recoil above 0, R2 alone also pulls the stick, including melee and driving.
- Results depend on DayZ's own controller sensitivity settings.
