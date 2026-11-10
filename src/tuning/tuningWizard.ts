import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Interaction,
  type StringSelectMenuInteraction,
} from 'discord.js';
import { tcpEmbed } from '../bot/embeds.js';
import { startTicket, ticketsEnabled } from '../tickets/ticketSystem.js';
import { PROBLEMS, advance, planFor, type ProblemKey, type Result, type Setup } from './tuningWizardRules.js';

// The tuning wizard ("Fix my aim"): a private walk-through on the help channel panel and /tcp tune. It asks
// which T.C.P the member has (and, on Premium, whether a recorded Workshop slot is selected), checks their
// DayZ sensitivity first, then gives one change at a time for the problem they pick, and asks how it went.
// If nothing works it offers a ticket with what they tried filled in.

const PREFIX = 'tcp-tune:';
export const TUNE_START_ID = `${PREFIX}start`;
const STATE_MS = 30 * 60 * 1000;

interface WizardState extends Setup {
  problem: ProblemKey | null;
  step: number;
  times: number;
  tried: string[];
  at: number;
}

const states = new Map<string, WizardState>();

function prune(now = Date.now()): void {
  for (const [id, state] of states) if (now - state.at > STATE_MS) states.delete(id);
}

const button = (id: string, label: string, style = ButtonStyle.Secondary) => new ButtonBuilder().setCustomId(`${PREFIX}${id}`).setLabel(label).setStyle(style);
const row = (...buttons: ButtonBuilder[]) => new ActionRowBuilder<ButtonBuilder>().addComponents(...buttons);

export function tuneButton(): ButtonBuilder {
  return new ButtonBuilder().setCustomId(TUNE_START_ID).setLabel('🎯 Fix my aim').setStyle(ButtonStyle.Primary);
}

function card(description: string, footer?: string) {
  return tcpEmbed({ title: '🎯 Fix my aim', description, ...(footer ? { footer } : {}) });
}

function versionView() {
  return {
    embeds: [card('I will walk you through it one change at a time.\n\n**Which T.C.P do you use?**')],
    components: [row(button('ver:premium', 'T.C.P Premium', ButtonStyle.Primary), button('ver:free', 'Free version'))],
  };
}

function pullView() {
  return {
    embeds: [card('**Is a Weapon Workshop slot with a recorded pull selected?** The home screen then shows the slot (W1-W4) and a **PULL** badge.')],
    components: [row(button('pull:yes', 'Yes, a recorded pull'), button('pull:no', 'No'))],
  };
}

function sensitivityView() {
  return {
    embeds: [
      card(
        "First, DayZ's own controller settings: **are your aiming sensitivities (vertical and horizontal) close to each other?** Very different ones (for example vertical 1 and horizontal 5) make aiming feel uneven whatever T.C.P is set to.",
      ),
    ],
    components: [row(button('sens:yes', 'Yes, they are close', ButtonStyle.Success), button('sens:no', 'No, they are different'))],
  };
}

function sensitivityFixView(state: WizardState) {
  return {
    embeds: [
      card(
        `Bring them close together first (for example both 5). Then retune **Vertical Recoil**${state.premium ? ', and REDO any Weapon Workshop slot you recorded' : ''}, since the right value depends on that sensitivity.\n\nPress **Done** once they match.`,
      ),
    ],
    components: [row(button('sens:yes', 'Done, continue', ButtonStyle.Success))],
  };
}

function problemView(state: WizardState) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`${PREFIX}problem`)
    .setPlaceholder("What's wrong?")
    .addOptions(PROBLEMS.map((problem) => ({ label: problem.label, value: problem.key })));
  return {
    embeds: [card(`**What feels wrong?** Pick the closest one.${state.premium && state.pull ? '\n\nWith a recorded pull selected, recoil is tuned with Scale Y and Scale X.' : ''}`)],
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)],
  };
}

function stepView(state: WizardState, prefix = '') {
  const plan = planFor(state.problem!, state);
  const step = plan[state.step]!;
  const open = 'Open the menu with **L2 + OPTIONS** (LT + Menu on Xbox).';
  return {
    embeds: [
      card(
        [
          prefix,
          `**Step ${state.step + 1} of ${plan.length}${state.times > 0 ? ` (again)` : ''}:** ${step.text}`,
          '',
          `${open} Change only that, close the menu to save, then fire a few bursts with the same gun at the same distance. **How is it now?**`,
        ]
          .filter((line, index) => line || index > 0)
          .join('\n'),
        PROBLEMS.find((problem) => problem.key === state.problem)?.label,
      ),
    ],
    components: [
      row(
        button('res:fixed', '✅ Fixed', ButtonStyle.Success),
        button('res:better', '👍 Better, not yet'),
        button('res:same', '😐 No change'),
        button('res:worse', '👎 Worse', ButtonStyle.Danger),
      ),
    ],
  };
}

function doneView() {
  return {
    embeds: [card('Nice! Keep that setting: it is saved when the menu closes. Come back any time something feels off.')],
    components: [row(button('restart', 'Start over'))],
  };
}

function endView() {
  return {
    embeds: [
      card(
        "That's everything I would try for this one. Open a ticket and the T.C.P team will take a look: I'll fill in what you already tried. Include your in-game sensitivity and your T.C.P values.",
      ),
    ],
    components: [row(...(ticketsEnabled() ? [button('ticket', 'Open a ticket', ButtonStyle.Primary)] : []), button('restart', 'Start over'))],
  };
}

function freshState(): WizardState {
  return { premium: true, pull: false, problem: null, step: 0, times: 0, tried: [], at: Date.now() };
}

/** /tcp tune */
export async function handleTuneCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  prune();
  states.set(interaction.user.id, freshState());
  await interaction.reply({ ...versionView(), ephemeral: true });
}

function summary(state: WizardState): string {
  const problem = PROBLEMS.find((entry) => entry.key === state.problem)?.label ?? 'Aim problem';
  return [
    `Fix my aim: ${problem}`,
    `T.C.P ${state.premium ? 'Premium' : 'free version'}${state.premium ? (state.pull ? ', recorded Workshop slot selected' : ', no recorded slot') : ''}.`,
    state.tried.length > 0 ? `Already tried:\n${state.tried.map((line) => `- ${line}`).join('\n')}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export async function handleTuneInteraction(interaction: Interaction): Promise<boolean> {
  if (!(interaction.isButton() || interaction.isStringSelectMenu()) || !interaction.customId.startsWith(PREFIX)) return false;
  prune();
  const action = interaction.customId.slice(PREFIX.length);

  if (interaction.isButton() && (action === 'start' || action === 'restart')) {
    states.set(interaction.user.id, freshState());
    if (action === 'start') await interaction.reply({ ...versionView(), ephemeral: true });
    else await interaction.update(versionView());
    return true;
  }
  const state = states.get(interaction.user.id);
  if (!state) {
    await (interaction as ButtonInteraction | StringSelectMenuInteraction).update({
      embeds: [card('This walk-through timed out. Press **Start over**.')],
      components: [row(button('restart', 'Start over'))],
    });
    return true;
  }
  state.at = Date.now();

  if (interaction.isStringSelectMenu() && action === 'problem') {
    state.problem = interaction.values[0] as ProblemKey;
    state.step = 0;
    state.times = 0;
    await interaction.update(stepView(state));
    return true;
  }
  if (!interaction.isButton()) return false;

  if (action === 'ver:premium' || action === 'ver:free') {
    state.premium = action === 'ver:premium';
    state.pull = false;
    await interaction.update(state.premium ? pullView() : sensitivityView());
    return true;
  }
  if (action === 'pull:yes' || action === 'pull:no') {
    state.pull = action === 'pull:yes';
    await interaction.update(sensitivityView());
    return true;
  }
  if (action === 'sens:no') {
    await interaction.update(sensitivityFixView(state));
    return true;
  }
  if (action === 'sens:yes') {
    await interaction.update(problemView(state));
    return true;
  }
  if (action.startsWith('res:') && state.problem) {
    const result = action.slice(4) as Result;
    const plan = planFor(state.problem, state);
    const step = plan[state.step];
    if (step) state.tried.push(`${step.text.replace(/\*\*|_/g, '')} → ${result === 'fixed' ? 'fixed it' : result === 'better' ? 'better' : result === 'same' ? 'no change' : 'worse'}`);
    const moved = advance(plan, { step: state.step, times: state.times }, result);
    state.step = moved.progress.step;
    state.times = moved.progress.times;
    if (moved.next === 'done') {
      states.delete(interaction.user.id);
      await interaction.update(doneView());
    } else if (moved.next === 'end') {
      await interaction.update(endView());
    } else {
      const prefix = moved.undo ? 'Put that last setting back to what it was, then try this instead.' : moved.again ? 'Do the same once more.' : '';
      await interaction.update(stepView(state, prefix));
    }
    return true;
  }
  if (action === 'ticket') {
    states.delete(interaction.user.id);
    await startTicket(interaction, 'setup', summary(state));
    return true;
  }
  return false;
}
