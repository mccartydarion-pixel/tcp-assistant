// The tuning wizard's advice: for each problem, the changes to try in order, one at a time. It follows the
// Tuning Guide in knowledge/T.C.P_DOCUMENTATION.md. Premium names the Menu 2.0 groups; the free version names
// its pages. With a recorded Workshop slot selected, Vertical and Horizontal are locked, so the recoil steps use
// Scale Y / Scale X instead. Plain data and functions; tuningWizard.ts does the Discord side.

export type ProblemKey = 'climbs' | 'sinks' | 'left' | 'right' | 'target' | 'fast' | 'floaty' | 'jump' | 'rest';

export const PROBLEMS: { key: ProblemKey; label: string; recoil: boolean }[] = [
  { key: 'climbs', label: 'The gun climbs during a burst', recoil: true },
  { key: 'sinks', label: 'The aim gets pulled down / sinks', recoil: true },
  { key: 'left', label: 'The gun drifts left', recoil: true },
  { key: 'right', label: 'The gun drifts right', recoil: true },
  { key: 'target', label: 'Hard to stay on target while shooting', recoil: false },
  { key: 'fast', label: 'Aim is too fast or overshoots', recoil: false },
  { key: 'floaty', label: 'Aim feels laggy or floaty', recoil: false },
  { key: 'jump', label: 'Small movements do nothing, then it jumps', recoil: false },
  { key: 'rest', label: 'The aim moves when the stick is at rest', recoil: false },
];

export interface Step {
  text: string;
  /** How many more times "Better" or "No change" repeats this same step before moving on. */
  repeat?: number;
}

export interface Setup {
  premium: boolean;
  /** A Workshop slot with a recorded pull is selected (Premium only). */
  pull: boolean;
}

type Setting = 'vertical' | 'horizontal' | 'turn' | 'calibrate' | 'fireSens' | 'adsSens' | 'scaleY' | 'scaleX' | 'record' | 'micro' | 'recovery' | 'turnRelease' | 'deadzone' | 'antiDeadzone' | 'easing' | 'precision' | 'steadyHold';

const PREMIUM_GROUP: Partial<Record<Setting, string>> = {
  vertical: 'RECOIL',
  horizontal: 'RECOIL',
  turn: 'RECOIL',
  calibrate: 'RECOIL',
  fireSens: 'AIM',
  adsSens: 'AIM',
  scaleY: 'WORKSHOP',
  scaleX: 'WORKSHOP',
  record: 'WORKSHOP',
  micro: 'F.A.S.T.',
  recovery: 'F.A.S.T.',
  turnRelease: 'F.A.S.T.',
  deadzone: 'STICK',
  antiDeadzone: 'STICK',
};

const FREE_PAGE: Partial<Record<Setting, string>> = {
  vertical: 'Vertical Recoil',
  horizontal: 'Horizontal Recoil',
  turn: 'Turn Strength',
  calibrate: 'Calibrate Recoil',
  fireSens: 'Fire Sens',
  adsSens: 'ADS Sens',
  deadzone: 'Deadzone',
  antiDeadzone: 'Anti Deadzone',
  easing: 'Easing',
  precision: 'Precision',
  steadyHold: 'Steady Hold',
};

/** "(RECOIL group)" in Premium, "(its own page)" in the free version. */
function where(setup: Setup, setting: Setting): string {
  if (setup.premium) {
    const group = PREMIUM_GROUP[setting];
    return group ? ` _(${group} group)_` : '';
  }
  const page = FREE_PAGE[setting];
  return page ? ` _(the ${page} page)_` : '';
}

const RANDOM_SIDEWAYS = 'DayZ recoil also has a random sideways part no script can cancel, so a little wander is normal.';

export function planFor(problem: ProblemKey, setup: Setup): Step[] {
  const pull = setup.premium && setup.pull;
  const w = (setting: Setting) => where(setup, setting);
  switch (problem) {
    case 'climbs':
      return pull
        ? [
            { text: `Raise **Scale Y** by 5 (for example 100 to 105).${w('scaleY')}`, repeat: 3 },
            { text: `Does it only climb while you move the stick (tracking or steering)? Lower **Turn Strength** to about 70.${w('turn')}` },
            { text: `Still climbing on a steady spray? **REDO** that slot's recording${w('record')}: three full magazines at a mark, with your current in-game sensitivity.` },
          ]
        : [
            { text: `Raise **Vertical Recoil** by 2.${w('vertical')}`, repeat: 3 },
            { text: `Does it only climb while you move the stick (tracking or steering)? Lower **Turn Strength** to about 70.${w('turn')}` },
            { text: `Try **Calibrate Recoil**${w('calibrate')}: arm it, then fire one long burst (over a second) holding the aim on one point. It sets Vertical and Horizontal for you.` },
          ];
    case 'sinks':
      return [
        pull ? { text: `Lower **Scale Y** by 5 (for example 100 to 95).${w('scaleY')}`, repeat: 3 } : { text: `Lower **Vertical Recoil** by 2.${w('vertical')}`, repeat: 3 },
        {
          text: `If it only sinks while you pull down yourself, that is normal: the script already pulls, so pull less. If it drags down when you flick to a new target, raise **Turn Strength** back toward 100.${w('turn')}`,
        },
      ];
    case 'left':
    case 'right': {
      const left = problem === 'left';
      return pull
        ? [
            {
              text: `Look at the **H** on the home screen (the recorded sideways pull). If it is positive, ${left ? 'raise' : 'lower'} **Scale X** by 5; if it is negative, ${left ? 'lower' : 'raise'} it by 5.${w('scaleX')}`,
              repeat: 2,
            },
            { text: `Still drifting the same way? **REDO** that slot's recording${w('record')}. ${RANDOM_SIDEWAYS}` },
          ]
        : [
            { text: `${left ? 'Raise' : 'Lower'} **Horizontal Recoil** by 1 (${left ? 'toward positive: it pushes the aim right' : 'toward negative: it pushes the aim left'}).${w('horizontal')}`, repeat: 3 },
            { text: `Values from 0 to 5 are common; go a step at a time past that. ${RANDOM_SIDEWAYS}` },
          ];
    }
    case 'target':
      return [
        { text: `Lower **Turn Strength** to about 40, so moving the stick weakens the recoil pull less.${w('turn')}` },
        { text: `Lower **Fire Sens** to about 75, for steadier small corrections while firing.${w('fireSens')}` },
        setup.premium
          ? { text: `Raise **Micro Precision** by 10, for finer aim near the centre.${w('micro')}` }
          : { text: `Add a little **Easing** (10 to 15).${w('easing')}` },
      ];
    case 'fast':
      return [
        { text: `Lower **ADS Sens** by 5.${w('adsSens')}`, repeat: 1 },
        setup.premium
          ? { text: `Raise **Micro Precision** by 10: it makes fine aim near the centre finer without slowing big movements.${w('micro')}` }
          : { text: `Set **Precision** to 20-40: it slows the centre for finer control.${w('precision')}` },
      ];
    case 'floaty':
      return setup.premium
        ? [
            { text: `Raise **Recovery Speed** by 10: fine aim comes back faster after a turn.${w('recovery')}`, repeat: 1 },
            { text: `Raise **Turn Release** by 10: big movements pass straight through sooner.${w('turnRelease')}`, repeat: 1 },
          ]
        : [
            { text: `Lower **Easing** (try 0 to 10): Easing is smoothing, and too much feels floaty.${w('easing')}` },
            { text: `Set **Steady Hold** to 0, 1 or 2.${w('steadyHold')}` },
          ];
    case 'jump':
      return [
        { text: `Raise **Anti Deadzone** by 2: DayZ's own deadzone is swallowing small movements.${w('antiDeadzone')}`, repeat: 2 },
        {
          text: `Anti Deadzone also lifts the recoil pull, so retune Vertical and Horizontal now${setup.premium ? ' (for a recorded Workshop slot: Scale Y and Scale X, or a REDO)' : ''}.`,
        },
      ];
    case 'rest':
      return [
        { text: `Raise **Deadzone** by 2 until the aim stops moving on its own (stick drift).${w('deadzone')}`, repeat: 3 },
        { text: `If **Anti Deadzone** is above 0, lower it: too much makes the aim creep.${w('antiDeadzone')}` },
      ];
  }
}

export type Result = 'fixed' | 'better' | 'same' | 'worse';

export interface Progress {
  step: number;
  /** How many times the current step has been repeated. */
  times: number;
}

/** Where the wizard goes after a result: the next step (maybe the same one again), done, or out of steps. */
export function advance(plan: Step[], progress: Progress, result: Result): { next: 'done' | 'step' | 'end'; progress: Progress; again: boolean; undo: boolean } {
  if (result === 'fixed') return { next: 'done', progress, again: false, undo: false };
  const step = plan[progress.step];
  if (result !== 'worse' && step && progress.times < (step.repeat ?? 0)) {
    return { next: 'step', progress: { step: progress.step, times: progress.times + 1 }, again: true, undo: false };
  }
  const following = progress.step + 1;
  if (following >= plan.length) return { next: 'end', progress: { step: following, times: 0 }, again: false, undo: result === 'worse' };
  return { next: 'step', progress: { step: following, times: 0 }, again: false, undo: result === 'worse' };
}
