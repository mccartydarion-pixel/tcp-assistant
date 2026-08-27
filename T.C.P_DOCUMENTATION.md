# T.C.P. Technical Documentation

## Tactical Competitive Pro for Cronus Zen and PlayStation 5

**Document status:** Reference documentation for the current source
**Source:** `Tactical Competitive Pro.gpc`
**Platform:** Cronus Zen running GPC with a PlayStation 5 controller
**Target game context:** DayZ and other controller-based PvP environments
**Current menu layout:** 12 pages

---

## 1. Overview

T.C.P. (Tactical Competitive Pro) is a controller-input processing script for Cronus Zen. It combines:

- A master enable/disable control.
- A stable anti-recoil core with configurable vertical and horizontal correction.
- Player-input protection that yields to deliberate stick movement.
- Polar-coordinate analysis of the right stick.
- Player-intent classification for context-sensitive behavior.
- ADS Accuracy processing with adjustable sensitivity, precision, response, and easing.
- A short Automatic Aim R3 pulse when ADS begins.
- Automatic sprint/run behavior.
- Follow Lean behavior based on left-stick direction while ADS.
- A 12-page OLED menu with persistent settings.
- Non-blocking OLED animations and status screens.

The current Stable Core design deliberately keeps the configured vertical and horizontal recoil values authoritative. It does not use recoil phases, progressive patterns, time-based recoil decay, first-shot recoil bonuses, or active profile/speed/scale multipliers.

This document describes the behavior implemented in the live `.gpc` source. Earlier reports in the workspace may describe superseded 16-page or phase-based implementations; those historical details are identified below where relevant.

---

## 2. Important Safety and Testing Boundary

T.C.P. changes controller input before it reaches the console. It cannot guarantee accuracy, eliminate weapon sway or dispersion, compensate for network conditions, or determine the actual recoil behavior of every weapon and game update.

The source has been statically reviewed and is intended for Cronus Zen compilation, but the following require physical validation:

- Cronus Zen Studio compilation with the installed firmware.
- OLED readability and animation timing on the physical device.
- PS5 controller responsiveness.
- DayZ weapon-specific recoil behavior.
- Button mappings and game-specific ADS/fire thresholds.
- Manual R3 behavior outside the Automatic Aim pulse.
- Auto Run and Follow Lean behavior in live gameplay.

Use the script only where controller modification is permitted by the applicable game, server, competition, and platform rules.

---

## 3. Operating Model

The script runs in Cronus Zen's `init` and `main` blocks.

### 3.1 Initialization

During `init`, the script:

1. Loads persistent values from `SPVAR_1` through `SPVAR_17`.
2. Applies defaults and clamps values to their supported ranges.
3. Initializes the Stable Core runtime state.
4. Resets ADS Accuracy runtime state.
5. Starts the 480 ms boot animation.

### 3.2 Per-frame processing

Each `main` iteration:

1. Reads the elapsed frame time with `get_rtime()`.
2. Reads the raw L2, R2, L3, R3, LX, LY, RX, and RY values.
3. Filters small right-stick values for intent measurement.
4. Updates polar right-stick measurements.
5. Classifies player intent.
6. Updates the Follow Lean delay when ADS starts or ends.
7. Processes the L3 + R3 master toggle outside the menu.
8. Opens or closes the menu with L2 + OPTIONS.
9. Updates the TCP state.
10. Runs menu input handling, or gameplay modifications when active.
11. Updates OLED animations and redraws only when required.
12. Stores previous input values for the next frame.

### 3.3 Gameplay pipeline

When gameplay processing is active, the current order is:

```text
Raw controller input
  -> noise-filtered intent values
  -> polar motion analysis
  -> player-intent classification
  -> Automatic Aim pulse
  -> ADS Accuracy
  -> static vertical/horizontal recoil baseline
  -> direction-aware player-input protection
  -> precision hold behavior
  -> fire-entry ramp and asymmetric slew control
  -> headroom protection
  -> final +/-100 clamp
  -> one PS4_RX and one PS4_RY writer
```

The final output is assembled by `tcp_output_aim()`:

```text
final_rx = ads_processed_rx + gen6_smooth_h
final_ry = ads_processed_ry + gen6_smooth_v
```

Both axes are clamped to `-100..100` before being written with `set_val()`.

---

## 4. Runtime State Machine

The state constants are:

| State | Value | Meaning |
|---|---:|---|
| `TCP_STATE_DISABLED` | 0 | Master control is off. Gameplay modifiers do not run. |
| `TCP_STATE_MENU` | 1 | Menu is open. Menu inputs are handled and blocked from the game. |
| `TCP_STATE_IDLE` | 2 | Master is enabled, but the player is not ADS or firing. |
| `TCP_STATE_ADS` | 3 | L2 is above the ADS threshold, but R2 is not firing. |
| `TCP_STATE_FIRING` | 4 | Both L2 and R2 are above the fire threshold. |

`tcp_update_state()` evaluates these states in priority order:

1. Disabled if `master_enabled` is false.
2. Menu if `mod_menu` is true.
3. Firing if L2 and R2 are both above `FIRE_THRESHOLD`.
4. ADS if only L2 is above the threshold.
5. Idle otherwise.

The fire threshold is `20`.

Anti-recoil is active only while `ar_enabled` is true and the state is `TCP_STATE_FIRING`.

---

## 5. Controller Controls

### 5.1 Menu controls

| Input | Action |
|---|---|
| Hold L2 + press OPTIONS | Open or close the menu |
| LEFT | Move to the previous page; wraps from page 1 to page 12 |
| RIGHT | Move to the next page; wraps from page 12 to page 1 |
| X | Toggle a feature on a status page |
| UP | Increase an editable value by 1 |
| DOWN | Decrease an editable value by 1 |
| Hold X while pressing UP/DOWN | Adjust an editable value by 10 |
| CIRCLE | Save settings and exit the menu |
| Hold L1 + R1 + X for 2000 ms | Factory reset settings |

While the menu is open, the script blocks UP, DOWN, LEFT, RIGHT, X, CIRCLE, L1, R1, L2, R2, L3, and OPTIONS from reaching the game.

### 5.2 Master toggle

Outside the menu, hold L3 + R3 for 500 ms. The script then toggles `master_enabled`, persists the new value to `SPVAR_8`, and cleans up runtime state when disabling.

A lock prevents the toggle from repeating while the buttons remain held. Releasing either button clears the lock.

### 5.3 Factory reset

The factory reset combination is recognized only inside the menu:

```text
L1 + R1 + X held for 2000 ms
```

The reset restores the defaults listed in Section 7, saves them, cleans runtime state, and starts a menu-opening animation.

---

## 6. Current 12-page Menu

The live source defines `PAGE_COUNT = 12`.

| Page | Constant | OLED name | Type | Range/default |
|---:|---|---|---|---|
| 1 | `PAGE_MASTER` | Master Controls | Toggle | ON by default |
| 2 | `PAGE_ANTI_RECOIL` | Anti Recoil | Toggle | ON by default |
| 3 | `PAGE_ADS_ACCURACY` | ADS Accuracy | Toggle | ON by default |
| 4 | `PAGE_AUTO_RUN` | Auto Run | Toggle | ON by default |
| 5 | `PAGE_AUTO_AIM` | Automatic Aim | Toggle | ON by default |
| 6 | `PAGE_FOLLOW_LEAN` | Follow Lean | Toggle | ON by default |
| 7 | `PAGE_VERTICAL` | Vertical Recoil | Numeric | 0..100, default 25 |
| 8 | `PAGE_HORIZONTAL` | Horizontal Recoil | Signed numeric | -50..50, default 3 |
| 9 | `PAGE_ADS_SENS` | ADS Sens | Numeric | 0..100, default 90 |
| 10 | `PAGE_PRECISION` | Precision | Numeric | 0..100, default 45 |
| 11 | `PAGE_RESPONSE` | Response | Numeric | 0..100, default 95 |
| 12 | `PAGE_EASING` | Easing | Numeric | 0..100, default 8 |

Pages 1 through 6 show an animated ON/OFF status control. Pages 7 through 12 show the current value and an animated value bar. Horizontal Recoil uses a centered signed indicator so negative and positive values are visually distinct.

### 6.1 Compatibility-only settings

The source still loads and saves these legacy values to preserve existing configurations:

- Profile (`SPVAR_2`)
- Pattern Speed (`SPVAR_5`)
- V Scale (`SPVAR_6`)
- H Scale (`SPVAR_7`)

They are not exposed as current menu pages and do not affect the active Stable Core recoil calculation. Their persisted slots remain intact so older configurations do not become misaligned.

---

## 7. Defaults and Ranges

| Setting | Source variable | Range | Default |
|---|---|---:|---:|
| Master | `master_enabled` | 0..1 | 1 |
| Anti Recoil | `ar_enabled` | 0..1 | 1 |
| ADS Accuracy | `ads_accuracy_enabled` | 0..1 | 1 |
| Auto Run | `auto_run_enabled` | 0..1 | 1 |
| Automatic Aim | `auto_ads_enabled` | 0..1 | 1 |
| Follow Lean | `follow_lean_enabled` | 0..1 | 1 |
| Vertical Recoil | `gen6_vertical` | 0..100 | 25 |
| Horizontal Recoil | `gen6_horizontal` | -50..50 | 3 |
| Turn Strength | `gen6_turn_strength` | 0..100 | 100 |
| ADS Sens | `ads_accuracy_sens` | 0..100 | 90 |
| Precision | `ads_accuracy_precision` | 0..100 | 45 |
| Response | `ads_accuracy_response` | 0..100 | 95 |
| Easing | `ads_accuracy_easing` | 0..100 | 8 |
| Legacy Profile | `gen6_profile` | 0..2 | Progressive |
| Legacy Pattern Speed | `gen6_pattern_speed` | 75..125 | 100 |
| Legacy V Scale | `gen6_v_scale` | 50..150 | 100 |
| Legacy H Scale | `gen6_h_scale` | 50..150 | 95 |

The configured Vertical and Horizontal values are the active recoil baseline. The legacy profile, pattern speed, V Scale, and H Scale values are clamped and persisted but are compatibility-only in the current Stable Core path.

---

## 8. Polar Input Analysis

`polar_input_update()` uses Cronus Zen's native API:

```text
get_ipolar(POLAR_RS, POLAR_ANGLE)
get_ipolar(POLAR_RS, POLAR_RADIUS)
```

### 8.1 Radius normalization

The native radius is treated as a `0..32767` value and converted to a logical `0..100` value:

$$
polar\_raw\_radius = \frac{polar\_raw\_radius\_native \times 100}{32767}
$$

The result is clamped to `0..100`. The native value is retained separately in `polar_raw_radius_native`.

Representative mappings are:

| Native radius | Logical radius |
|---:|---:|
| 0 | 0 |
| about 3277 | about 10 |
| about 8192 | about 25 |
| about 16384 | about 50 |
| about 24575 | about 75 |
| 32767 | 100 |

### 8.2 Angle and wrap handling

Angles are clamped to `0..359`. The absolute angle difference is converted to the shortest circular distance:

```text
angle_delta = abs(current_angle - previous_angle)
if angle_delta > 180:
    angle_delta = 360 - angle_delta
```

For example, a change from 350 degrees to 10 degrees is treated as a 20-degree movement, not a 340-degree movement.

### 8.3 Deadzone safety

When logical radius is `4` or less, angle velocity is forced to zero. This prevents unstable angle calculations while the stick is centered or near the deadzone.

### 8.4 Reversal classification

If both the current and previous logical radius are above `4`, angular velocity is classified as:

| Angular delta | Classification |
|---:|---|
| Less than 45 degrees | `POLAR_REVERSAL_NONE` |
| 45..89 degrees | `POLAR_REVERSAL_SMALL` |
| 90..134 degrees | `POLAR_REVERSAL_MEDIUM` |
| 135..180 degrees | `POLAR_REVERSAL_HARD` |

A hard reversal resets aim momentum. Low-radius suppression remains active for all classifications.

### 8.5 Momentum and quality

Aim momentum rises by `2` per frame when both angle and radius movement are within the stick deadzone. Otherwise it falls by `5`, clamped to `0..100`.

The script derives:

- `polar_intent_stability`
- `polar_aim_quality`
- `polar_radius_velocity`
- `polar_angle_velocity`
- `polar_angle_acceleration`
- `player_strafe_mag`

These values influence intent handling and ADS Accuracy behavior; they do not create a recoil pattern.

---

## 9. Player Intent Classification

Before classification, `tcp_input_noise_filter()` ignores RX/RY values whose absolute magnitude is `2` or less. This filtering is used for intent measurement only; raw stick values remain available to the rest of the script.

The script calculates the greater of filtered RX and RY magnitude as `intent_magnitude`, then combines it with polar motion data.

### 9.1 Intent categories

| Intent | Detection emphasis | Purpose |
|---|---|---|
| `INTENT_IDLE` | Magnitude <= 2 and velocity <= 3 | No meaningful aim movement |
| `INTENT_MICRO` | Magnitude <= 8 | Fine corrections |
| `INTENT_PRECISION` | Magnitude <= 25 | Deliberate small targeting movement |
| `INTENT_TRACKING` | Intermediate movement | Smooth target following |
| `INTENT_STRAFE` | LX >= 21 with low aim magnitude | Movement-focused input |
| `INTENT_HARD_CORRECTION` | Magnitude >= 56, major direction change, or velocity >= 55 | Fast manual correction |
| `INTENT_TURN` | Magnitude >= 81 or polar radius >= 71 | Large turn or flick |

Intent priority is ordered from lowest to highest as Idle, Micro, Precision, Tracking, Strafe, Hard Correction, and Turn.

### 9.2 Hysteresis

The selected candidate can replace the current intent immediately when its priority is equal or higher. When a lower-priority intent is detected, it must remain present for two release frames before replacing the current intent. This reduces rapid state chatter around boundaries.

---

## 10. Stable Core Anti-Recoil

### 10.1 Static baseline

`gen6_build_static_baseline()` copies the configured values directly:

```text
gen6_base_v = gen6_vertical
gen6_base_h = gen6_horizontal
```

The values are then clamped to the active correction ranges. No profile curve, phase interpolation, energy decay, first-shot bonus, or active V/H scale multiplication is applied.

This means a Vertical value of `36` remains a baseline of `36` throughout a firing session before player-input protection and smoothing are applied.

### 10.2 Firing lifecycle

`gen6_update_fire_state()` uses L2 and R2:

- Both above `20`: active firing state.
- Previously active, then either trigger released: released state for cleanup.
- Otherwise: idle state.

A new firing entry starts a `45 ms` fire-entry timer. The timer is capped at `45 ms` and is used to ramp the script correction into the output.

### 10.3 Player-input protection

The protection layer is axis-specific:

1. Measure absolute raw intent magnitude for each axis.
2. Measure per-frame raw velocity for each axis.
3. Use the larger magnitude or velocity as the axis intent.
4. Convert intent through a soft-knee scale.
5. Reduce the scale to `70%` when the user's stick direction opposes the correction direction.
6. Give precision hold a full `100%` stick scale.
7. Apply Turn Strength.
8. Clamp the final protection scale to `15..100%`.
9. Multiply the correction by the resulting scale.

The soft-knee scale preserves more recoil correction for small movements and yields more as deliberate movement becomes larger. Its effective regions are:

| Intent region | Base scale behavior |
|---|---|
| 0..8 | 100% |
| 9..25 | Gradual reduction from 100% |
| 26..55 | Reduction from 86% toward 50% |
| 56..75 | Reduction from 50% toward 15% |
| Above 75 | 15% turn floor |

Turn Strength controls how strongly the soft-knee reduction is applied. At the default `100`, it is fully applied. Lower values retain more recoil correction during movement.

### 10.4 Precision hold

Precision hold activates only after `80 ms` of stable firing conditions. It is cleared when any of the following occurs:

- Not actively firing.
- L2 falls to or below the fire threshold.
- Raw RX or RY exceeds `6`.
- RX or RY changes by more than `6` from the previous frame.
- Left-stick strafe magnitude exceeds `20`.
- A hard polar reversal occurs.

While active, precision hold sets the intermediate H/V player scale back to `100%`, preserving the configured correction during steady micro-aim.

### 10.5 Asymmetric slew and fire-entry ramp

The correction target is ramped from zero during the first `45 ms`:

$$
 slew\_target = \frac{correction \times fire\_entry\_timer}{45ms}
$$

The slew controller uses:

- Attack step: `4` units per frame.
- Normal release step: `9` units per frame.
- Tracking/strafe release step: `6` units per frame.

When the current and target values have opposite signs, the current value is first released toward zero. Hard reversals and Turn intent bypass the gradual slew and move smoothing directly to the target.

### 10.6 Output headroom

Before the final clamp, `tcp_apply_headroom()` limits recoil correction so it cannot push the already-processed ADS value outside the controller range. This preserves available headroom on both axes.

The final output stage then clamps both axes to `-100..100` and performs exactly one write for each:

```text
set_val(PS4_RX, final_rx)
set_val(PS4_RY, final_ry)
```

---

## 11. ADS Accuracy

`ads_accuracy_run()` runs while ADS is enabled and L2 is above `20`.

### 11.1 ADS blend

On ADS entry, processing blends from raw stick input toward ADS-processed input over `150 ms`:

```text
ads_accuracy_blend = timer * 100 / 150 ms
```

When ADS is not active or ADS Accuracy is disabled, the runtime state is reset and the raw RX/RY values are passed through as the processed aim vector.

### 11.2 Sensitivity

ADS Sens is applied exactly once to the base RX/RY values:

```text
ads_base_rx = rx_raw * ads_accuracy_sens / 100
ads_base_ry = ry_raw * ads_accuracy_sens / 100
```

The blend then transitions from raw input to those scaled values.

### 11.3 Precision, response, and easing

The three remaining ADS settings shape the transition and smoothing behavior:

- **Precision:** How strongly small movements are treated as deliberate fine aiming.
- **Response:** How quickly the processed input reacts.
- **Easing:** How much smoothing is used during smaller movements.

Left-stick strafe magnitude modifies these values:

- Strafe reduces the effective precision factor, with a floor of `30%`.
- Strafe reduces the effective easing factor, with a floor of `30%`.
- Strafe increases effective response by up to `15` points.

Hard Correction and Turn intent reduce precision and easing while setting response to `100`. A hard polar reversal reduces precision more aggressively, sets easing to zero, and sets response to `100`. Tracking reduces easing by half. Low polar aim quality also halves precision.

### 11.4 Magnitude-dependent smoothing

Large aim input, at magnitude `71` or higher, bypasses the smaller-input smoothing path. Smaller movements use the calculated smoothing factor, with additional reductions for movement above `10` and `25` magnitude. Hard reversals and turns use the current processed value immediately.

---

## 12. Automatic Aim

Automatic Aim is controlled by `auto_ads_enabled` and only operates while L2 is above the fire threshold.

On a new L2 press, provided L3 is not held:

1. The script calls `run_stop_sprint()` to prevent a sprint pulse from overlapping ADS entry.
2. It starts a `50 ms` Automatic Aim timer.
3. While the timer is positive, it sets `PS4_R3` to `100`.
4. After the timer expires, R3 is no longer written by this feature.

The pulse is triggered once per ADS entry, not repeatedly for the duration of a held L2 input.

Physical/manual R3 input remains available outside the Automatic Aim pulse.

---

## 13. Auto Run

Auto Run is active when both Master and Auto Run are enabled, and L2 is not above the threshold.

When `LY <= -25`, the script:

- Forces `PS4_LY` to `-100`.
- Forces `PS4_L3` to `100`.
- Marks `run_pulse_active` true.

When the threshold is no longer met, or ADS begins, `run_stop_sprint()` releases L3 and clears the pulse state.

Auto Run is also stopped when the feature is disabled or the master control is turned off.

---

## 14. Follow Lean

Follow Lean requires the feature to be enabled, L2 above the threshold, and the 125 ms ADS-entry delay to have expired.

After ADS begins, `follow_lean_timer` counts down from `125 ms`. During that window no automatic lean button is emitted.

Once the delay expires:

- LX below `-20` causes `PS4_L1` to be set to `100`.
- LX above `+20` causes `PS4_R1` to be set to `100`.
- Values within the threshold produce no automatic lean input.

The delay is reset when ADS is released and is also cleared during runtime cleanup.

---

## 15. Persistent Configuration

The script uses Cronus Zen persistent variables without remapping them:

| Slot | Meaning | Active in current runtime? |
|---:|---|---|
| `SPVAR_1` | ADS Accuracy enabled | Yes |
| `SPVAR_2` | Profile | Compatibility-only |
| `SPVAR_3` | Auto Run enabled | Yes |
| `SPVAR_4` | Automatic Aim enabled | Yes |
| `SPVAR_5` | Pattern Speed | Compatibility-only |
| `SPVAR_6` | V Scale | Compatibility-only |
| `SPVAR_7` | H Scale | Compatibility-only |
| `SPVAR_8` | Master enabled | Yes |
| `SPVAR_9` | Anti Recoil enabled | Yes |
| `SPVAR_10` | Follow Lean enabled | Yes |
| `SPVAR_11` | ADS Sens | Yes |
| `SPVAR_12` | Precision | Yes |
| `SPVAR_13` | Response | Yes |
| `SPVAR_14` | Easing | Yes |
| `SPVAR_15` | Vertical Recoil | Yes |
| `SPVAR_16` | Horizontal Recoil | Yes |
| `SPVAR_17` | Turn Strength | Yes |

Settings are saved when the menu is closed with CIRCLE or when the L2 + OPTIONS close action is used. Toggle changes to Master are persisted immediately when the master shortcut or Master page is used.

---

## 16. Runtime Cleanup

Cleanup functions prevent stale state from carrying into a later ADS or firing session.

`tcp_reset_runtime()` clears:

- Auto Run pulse state.
- Automatic Aim timer.
- Follow Lean delay.
- Anti-recoil correction, smoothing, intent, precision hold, slew targets, and fire-entry timing.
- ADS Accuracy timers, smoothing state, and processed values.
- Polar history and initialization state.

Anti-recoil release clears its own correction state. ADS release resets ADS Accuracy. Disabling Master, disabling Anti Recoil, closing the menu, and factory reset all use cleanup paths appropriate to their scope.

---

## 17. OLED User Interface

The OLED system is separate from gameplay calculations and is designed to avoid blocking the controller loop.

### 17.1 Animation states

The source supports:

- Boot animation.
- Menu-open animation.
- Page-left transition.
- Page-right transition.
- Toggle animation.
- Numeric value animation.
- Save confirmation animation.

### 17.2 Timing

| UI behavior | Duration |
|---|---:|
| UI redraw frame limiter | 30 ms |
| Boot animation | 480 ms |
| Menu open | 120 ms |
| Page transition | 120 ms |
| Toggle animation | 100 ms |
| Value animation | 100 ms |
| Save confirmation | 300 ms |
| Home activity frame | 500 ms |

The UI uses `get_rtime()` through `frame_time`; it does not use `wait()`, `sleep()`, `delay()`, or animation loops that block gameplay.

Static screens redraw only when `ui_dirty` is set. Active animations redraw at the 30 ms frame interval. Home activity is suppressed while ADS and firing are both active.

### 17.3 Screens

- Boot screen: T.C.P. branding and Stable Core 2.0 text.
- Home screen: T.C.P. logo, ONLINE/OFFLINE state, menu access hint.
- Menu pages: page number, feature name, status or value, and navigation footer.
- Save screen: animated checkmark and SAVED label.

---

## 18. Design Decisions and Removed Legacy Behavior

The current implementation intentionally favors predictable output over a larger adaptive recoil model.

Removed or inactive behaviors include:

- P1/P2/P3/P4 phase progression.
- Phase interpolation.
- Time-based recoil energy decay.
- First-shot recoil bonus.
- Active recoil profile curves.
- Active Pattern Speed control.
- Active V Scale and H Scale multiplication.
- Stacked recoil conflict multipliers.
- Automatic changes to ADS Precision, Response, or Easing during the Automatic Aim pulse.
- Duplicate RX/RY output writers.

The remaining adaptive behavior is limited to player-input protection, intent-aware ADS shaping, smoothing, fire-entry ramping, headroom protection, and the separate Auto Run/Follow Lean/Automatic Aim features.

---

## 19. Validation Checklist

### Static/source validation

- [ ] Cronus Zen Studio reports no compiler errors.
- [ ] All 12 menu pages render and wrap correctly.
- [ ] Each toggle changes the intended setting.
- [ ] UP/DOWN changes editable values and X + UP/DOWN uses step 10.
- [ ] CIRCLE saves and exits.
- [ ] L1 + R1 + X held for 2000 ms restores defaults.
- [ ] L3 + R3 held for 500 ms toggles Master once per hold.
- [ ] Only one final RX writer and one final RY writer are active.

### Functional controller validation

- [ ] ADS Accuracy blends in over approximately 150 ms.
- [ ] ADS Sens changes processed aim exactly once.
- [ ] Automatic Aim produces one 50 ms R3 pulse on ADS entry.
- [ ] Manual R3 remains usable outside the pulse.
- [ ] Auto Run starts at LY <= -25 and stops on ADS entry.
- [ ] Follow Lean waits 125 ms after ADS entry.
- [ ] Left and right lean thresholds behave independently.
- [ ] Menu inputs do not reach the game.

### Stable Core validation

- [ ] Vertical and Horizontal values produce a predictable baseline.
- [ ] Baseline does not decay over sustained firing.
- [ ] Small aim movements preserve most correction.
- [ ] Deliberate large turns reduce correction.
- [ ] Opposing stick direction yields more strongly than aligned input.
- [ ] Precision hold activates after approximately 80 ms of stable fire.
- [ ] Hard reversal releases smoothing immediately.
- [ ] Fire entry ramps correction over approximately 45 ms.
- [ ] Final output never exceeds the `-100..100` controller range.

### DayZ and hardware validation

- [ ] Test several weapons and recoil directions.
- [ ] Test ADS-only, firing, release, and re-burst transitions.
- [ ] Test micro-aim, tracking, strafe, hard correction, and full turns.
- [ ] Confirm there is no controller drift or unexpected button activation.
- [ ] Confirm physical OLED readability in normal play.
- [ ] Test after controller reconnect and Cronus Zen restart.

---

## 20. Known Limitations

1. GPC integer arithmetic limits precision to whole-number operations.
2. The source cannot identify weapons or dynamically learn a weapon's recoil pattern.
3. The script does not remove DayZ sway, dispersion, weapon damage variation, latency, or network effects.
4. Actual feel depends on game sensitivity, deadzones, controller condition, firmware, and Cronus Zen compiler behavior.
5. The current source has no hardware-side automated test harness; physical testing remains required.
6. The legacy Profile, Pattern Speed, V Scale, and H Scale values persist for compatibility but are not active controls in the current Stable Core recoil path.

---

## 21. Source Function Index

| Function | Responsibility |
|---|---|
| `tcp_update_state()` | Selects Disabled, Menu, Idle, ADS, or Firing state |
| `polar_input_update()` | Reads and analyzes right-stick polar input |
| `player_intent_update()` | Classifies intent and applies hysteresis |
| `tcp_input_noise_filter()` | Removes tiny RX/RY values from intent measurements |
| `intent_priority()` | Orders intent categories for hysteresis decisions |
| `automatic_aim_run()` | Generates the ADS-entry R3 pulse |
| `gen6_init()` | Clamps and initializes Stable Core settings |
| `gen6_save_settings()` | Persists Stable Core and ADS settings |
| `gen6_reset_runtime_state()` | Clears anti-recoil runtime state |
| `polar_reset_runtime()` | Clears polar history and derived motion state |
| `gen6_update_fire_state()` | Tracks fire entry and release |
| `gen6_build_static_baseline()` | Loads authoritative V/H correction values |
| `gen6_apply_modifiers()` | Clamps the current correction values |
| `stable_core_precision_hold_update()` | Confirms or clears stable precision hold |
| `soft_knee_scale()` | Converts movement intent into a correction scale |
| `stable_core_direction_scale()` | Reduces correction against opposing input |
| `stable_core_slew_axis()` | Moves an axis toward its target with slew rules |
| `gen6_apply_player_input_protection()` | Applies soft-knee, direction, turn, and precision logic |
| `gen6_apply_smoothing()` | Applies fire-entry ramp and slew behavior |
| `ads_accuracy_reset_runtime()` | Clears ADS processing and smoothing state |
| `ads_accuracy_run()` | Processes ADS aim input |
| `gen6_run_anti_recoil()` | Runs the Stable Core firing path |
| `tcp_apply_headroom()` | Prevents output overflow before clamping |
| `tcp_output_aim()` | Performs the final RX/RY writes |
| `handle_page_input()` | Handles menu navigation, toggles, and reset input |
| `factory_reset_settings()` | Restores and saves defaults |
| `adjust_current_page()` | Changes editable page values |
| `current_page_value()` | Reads the value represented by the current page |
| `block_menu_inputs()` | Prevents menu controls reaching the game |
| `run_gameplay_mods()` | Calls the gameplay feature pipeline |
| `run_auto_lean()` | Emits Follow Lean button input |
| `run_auto_run()` | Emits Auto Run input |
| `run_stop_sprint()` | Releases the Auto Run sprint pulse |
| `tcp_reset_runtime()` | Performs full mod cleanup |
| `save_settings()` | Persists all user-facing settings |
| `cleanup_mod_state()` | Starts complete modification cleanup |
| `cleanup_ads_state()` | Clears the Automatic Aim timer |
| `ui_start_animation()` | Initializes a timed OLED animation |
| `ui_update()` | Advances animations and controls redraws |
| `ui_render_animation()` | Selects the current animated OLED frame |
| `draw_page_transition()` | Renders the page-change transition frame |
| `draw_tcp_crosshair()` | Draws the reusable OLED crosshair primitive |
| `draw_splash()` | Renders the boot branding screen |
| `draw_home_screen()` | Renders the idle status screen |
| `draw_idle()` | Clears and renders the idle display |
| `draw_saved()` | Renders the save confirmation screen |
| `draw_mod_page()` | Renders the current menu page |
| `draw_page_name()` | Renders the current page label |
| `draw_page_footer()` | Renders navigation and adjustment hints |
| `draw_page_status()` | Renders an animated ON/OFF control |
| `draw_page_value()` | Renders an unsigned numeric setting |
| `draw_page_signed()` | Renders a signed numeric setting |
| `ui_display_value()` | Interpolates a value during its animation |
| `page_enabled()` | Reads the toggle represented by the current page |
| `print_unsigned()` | Formats and prints a non-negative integer |
| `print_signed()` | Formats and prints a signed integer |
| `clamp_val()` | Restricts a value to a range |
| `abs_val()` | Returns an integer absolute value |

---

## 22. Release Summary

T.C.P. is currently a Stable Core controller-processing script with:

- A compact 12-page interface.
- Persistent settings with backward-compatible SPVAR slots.
- Static, measurable V/H anti-recoil baselines.
- Intent-aware protection that yields to manual aim.
- ADS Accuracy with independent user settings.
- Separate Auto Aim, Auto Run, and Follow Lean features.
- Non-blocking animated OLED feedback.
- One authoritative final output stage for each right-stick axis.

The source is suitable for Cronus Zen Studio compilation and structured physical validation. Production confidence depends on testing the compiled script on the intended PS5, controller, firmware, and game configuration.
