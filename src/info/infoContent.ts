import type { InfoKey, InfoLinks, InfoSection } from './infoChannels.js';

// The wording of the four info channels. Facts come from knowledge/T.C.P_DOCUMENTATION.md; keep the two in
// step. Button names are PlayStation first, Xbox in brackets. Each channel is one message: at most 10
// sections and 6000 characters in all (tests/info-channels.test.ts checks).

function link(id: string | undefined, fallback: string): string {
  return id ? `<#${id}>` : fallback;
}

function places(links: InfoLinks) {
  return {
    help: link(links.help, '**#ask-tcp**'),
    licence: link(links.licence, 'the **license channel**'),
    dayz: link(links.dayz, 'the **DayZ channel**'),
    tickets: links.tickets ? `the ticket panel in <#${links.tickets}>` : 'the **ticket panel**',
    bugs: links.bugs ? `<#${links.bugs}>` : undefined,
    overview: `<#${links.channels.overview}>`,
    faq: `<#${links.channels.faq}>`,
    disclaimer: `<#${links.channels.disclaimer}>`,
    rules: `<#${links.channels.rules}>`,
  };
}

function overview(links: InfoLinks): InfoSection[] {
  const at = places(links);
  return [
    {
      title: '🎯 Tactical Competitive Pro',
      description: [
        '**T.C.P** is a **Cronus Zen** script for **DayZ** on **PlayStation and Xbox**, built for competitive PvP.',
        'It steadies your recoil, shapes how your aim feels and adds movement tools, all tuned from a menu on the Zen\'s own screen. Use a PlayStation or Xbox controller.',
        '',
        '> T.C.P makes recoil and aiming more consistent. It does not aim for you: DayZ\'s sway, random recoil and latency are still there.',
      ].join('\n'),
    },
    {
      title: '✨ Features',
      fields: [
        {
          name: '🎯 Stable Core anti-recoil',
          value:
            'A steady pull against recoil while you aim and fire, set with **Vertical** and **Horizontal Recoil**. It backs off when you flick, holds while you track and fades out smoothly when you stop. **Calibrate Recoil** can set it from one burst.',
        },
        {
          name: '🔭 ADS Accuracy 2.0',
          value: 'Shape the stick while aiming: ADS Sens, ADS Vertical, Fire Sens, Precision, Easing, Response and Steady Hold, with two ADS profiles.',
        },
        { name: '⬇️ Drop Shot & Crouch Shot', value: 'Go prone (or crouch) the moment you aim and fire, then stand back up. Off until you switch it on.' },
        { name: '↔️ Follow Lean & Lean Spam', value: 'Lean with the left stick while aiming, or rock left and right in a fight so your head is harder to hit.' },
        { name: '🏃 Auto Run & Auto Movement', value: 'Auto Run holds sprint for you. Auto Movement (moonwalk) runs forward while strafing in a rhythm, with an optional 180 turn.' },
        { name: '🎮 Controller tweaks', value: 'Automatic Aim, Hair Triggers, Deadzone and Anti Deadzone.' },
        {
          name: '🔫 Weapon Workshop · Premium',
          value: 'Record the recoil pull each gun needs, right on the Zen, in up to four weapon slots. Pick the slot when you switch guns.',
        },
      ],
    },
    {
      title: '🆓 Free vs 💎 Premium',
      fields: [
        {
          name: '🆓 Free',
          value: ['• On the Cronus marketplace', '• Every feature except the Weapon Workshop', '• No lock, no code', `• **Download** in ${at.dayz}`].join('\n'),
          inline: true,
        },
        {
          name: '💎 T.C.P Premium',
          value: [
            '• **$15 a month** or **$70 a year**',
            '• Everything in Free **+ Weapon Workshop**',
            '• **Elite Supporter** role',
            '• Script sent to your DMs',
            `• Unlocked with a code from ${at.licence}`,
          ].join('\n'),
          inline: true,
        },
        {
          name: '​',
          value: `Press **Subscribe** (or **Yearly**) in ${at.licence} to join. There is no free trial. Cancel any time with **Manage subscription**.`,
        },
      ],
    },
    {
      title: '🚀 Getting started',
      description: [
        `**1.** Get the script: **Free** with **Download** in ${at.dayz}, or **Premium** in your DMs after you subscribe (or **Download Premium** in ${at.licence}).`,
        '**2.** Add it to **Zen Studio** and program it to a slot on your Cronus Zen.',
        `**3.** Premium only: press **X** (**A**) on the lock screen for your 5-digit number, press **Generate** in ${at.licence} and enter the 6-digit code you get.`,
        '**4.** Open the menu: hold **L2** and press **OPTIONS** (**LT** + **Menu**).',
        '**5.** Check your DayZ in-game aim sensitivity, then tune **Vertical** and **Horizontal Recoil**.',
        '',
        'Hold **L3 + R3** (**LS + RS**) for one second to switch the whole script on or off.',
      ].join('\n'),
    },
    {
      title: '🆘 Need help?',
      description: [
        `• **Questions:** ask in ${at.help}, no @mention needed. The assistant answers from the T.C.P docs.`,
        `• **License, payments or something it can't fix:** open a ticket from ${at.tickets}.`,
        ...(at.bugs ? [`• **Found a bug?** Report it in ${at.bugs}.`] : []),
        `• Quick answers in ${at.faq}. Please read ${at.rules} and ${at.disclaimer} too.`,
      ].join('\n'),
    },
  ];
}

function faq(links: InfoLinks): InfoSection[] {
  const at = places(links);
  return [
    {
      title: '❓ Frequently Asked Questions',
      description: `Quick answers to the questions we get most. Button names are PlayStation first, Xbox in brackets.\nNot covered here? Ask in ${at.help}.`,
    },
    {
      title: '🎮 Getting started',
      fields: [
        {
          name: 'What is T.C.P?',
          value:
            'A Cronus Zen script for DayZ PvP: anti-recoil, ADS Accuracy 2.0 and movement tools, tuned from a menu on the Zen\'s screen. It makes recoil and aim more consistent; it can\'t remove DayZ\'s sway, random recoil or latency.',
        },
        {
          name: 'Which consoles and controllers?',
          value:
            'DayZ on **PlayStation and Xbox**, with a PlayStation or Xbox (Series X|S or One) controller plugged into the Zen. Everything works the same on both, except the L2 + SHARE profile swap, which is PlayStation only.',
        },
        {
          name: 'How do I install it?',
          value: `Get the file (Free: **Download** in ${at.dayz}. Premium: your DMs, or **Download Premium** in ${at.licence}), add it to **Zen Studio** and program it to a slot on your Zen.`,
        },
        {
          name: 'How do I use the menu?',
          value:
            '**L2 + OPTIONS** (**LT + Menu**) opens and closes it. **LEFT/RIGHT** change page, **UP/DOWN** change a value (hold **X** (**A**) for steps of 10), **X** (**A**) switches on/off, **L1/R1** (**LB/RB**) move between items, **Circle** (**B**) saves and exits.',
        },
        {
          name: 'The script does nothing?',
          value: 'Master may be off. Hold **L3 + R3** (**LS + RS**) for one second: one buzz means on, two mean off. Also check the feature\'s own page is on.',
        },
      ],
    },
    {
      title: '🎯 Tuning',
      fields: [
        {
          name: 'How do I set Vertical and Horizontal Recoil?',
          value:
            '**Check your in-game aim sensitivity first:** a higher in-game vertical sensitivity needs a lower Vertical. Gun climbs: raise **Vertical** 1–2 at a time. Aim sinks: lower it. Drifts right: lower **Horizontal**; drifts left: raise it. Or let **Calibrate Recoil** set both from a one-second burst at a wall.',
        },
        {
          name: 'What does Turn Strength do?',
          value:
            'How much moving your stick while firing weakens the recoil pull. **Higher = your stick takes over more** (less recoil control while you move). It is not the recoil strength. Default 100; try about 40 if the gun climbs while you track.',
        },
      ],
    },
    {
      title: '💎 Premium & codes',
      fields: [
        {
          name: 'What does Premium add?',
          value: 'Everything in the free version **plus the Weapon Workshop**, the **Gen 8** recoil engine with **ACG** and **F.A.S.T. 2.0** aim shaping. $15 a month or $70 a year. You get the **Elite Supporter** role and the script in your DMs.',
        },
        {
          name: 'How do I buy or cancel?',
          value: `Press **Subscribe** (monthly) or **Yearly** in ${at.licence}; payment is through Stripe. Cancel, switch to yearly or change your card with **Manage subscription** on the same panel. There is no free trial.`,
        },
        {
          name: 'How do codes and power-ups work?',
          value: `Press **X** (**A**) on the lock screen for your 5-digit number, press **Generate** in ${at.licence}, type it in and enter the 6-digit code on the Zen. A code lasts a number of power-ups based on your days left (400 at 63+ days, 20 at 1–7). When they run out, press **Generate** again.`,
        },
        {
          name: 'What is the Weapon Workshop?',
          value:
            'Four slots (W1–W4). Pick a slot and gun, set **Mag** to the rounds in your magazine, arm **Record**, then fire three full magazines at a mark on a wall: T.C.P saves the steady pull that gun needs and uses it whenever that slot is selected. Fine-tune with **Scale Y / Scale X**. It is the last page (27/27): **L2 + OPTIONS**, then **LEFT** once. Not there? Get the latest with **Download Premium**.',
        },
        {
          name: 'My code doesn\'t work',
          value:
            'Check the number you typed in Discord is exactly the one on the Zen, then re-enter the code digit by digit. "Elite Supporters only" means you need an active subscription. Paid and still stuck? Open a **License & codes** ticket.',
        },
      ],
    },
    {
      title: '🆘 Still stuck?',
      description: [
        `Ask in ${at.help}, no @mention needed: the assistant replies in a thread. Include your controller, in-game sensitivity and T.C.P values.`,
        `License, payment or bug problems: open a ticket from ${at.tickets}.${at.bugs ? ` Bugs can also go in ${at.bugs}.` : ''}`,
      ].join('\n'),
    },
  ];
}

function disclaimer(links: InfoLinks): InfoSection[] {
  const at = places(links);
  return [
    {
      title: '⚠️ Disclaimer',
      tone: 'warning',
      description: 'Please read this before you download, buy or use T.C.P. By using it you accept the points below.',
    },
    {
      tone: 'warning',
      fields: [
        {
          name: '🏷️ Unofficial',
          value:
            'T.C.P is an independent script. It is not affiliated with, endorsed or sponsored by Bohemia Interactive (DayZ), Sony (PlayStation), Microsoft (Xbox) or Collective Minds (Cronus Zen). Their names and trademarks belong to them.',
        },
        {
          name: '🎲 Use at your own risk',
          value:
            'Using a Cronus Zen or any script may go against the rules of a game, platform or server. Any action taken against your account, by the game, the platform, a server or anti-cheat, is your own risk, and we cannot undo it.',
        },
        {
          name: '🎯 No guaranteed results',
          value:
            'T.C.P makes recoil and aiming more consistent; it does not aim for you. DayZ\'s random recoil, weapon sway, stamina, latency and desync are outside any script\'s control, and results depend on your settings and play.',
        },
        {
          name: '📋 Your responsibility',
          value: 'You are responsible for following the terms of DayZ, your console platform, Cronus and any server you play on.',
        },
        {
          name: '🔒 Licensed to you',
          value:
            'Premium is for you only. Don\'t share, upload, leak or resell the script or your codes. Premium copies are fingerprinted to the member they were sent to, and shared copies or codes can lose access.',
        },
        {
          name: '💳 Subscription & refunds',
          value: `T.C.P Premium is a subscription ($15 a month or $70 a year) that renews until you cancel. Cancel any time with **Manage subscription** in ${at.licence} to stop the next payment. Refunds are case by case, at the owner's discretion: open a ticket.`,
        },
        {
          name: '🔄 Changes',
          value: 'Features, prices and these terms can change. Changes are posted in this server, and using T.C.P after that means you accept them.',
        },
      ],
    },
  ];
}

function rules(links: InfoLinks): InfoSection[] {
  const at = places(links);
  return [
    {
      title: '📜 Server Rules',
      description: 'Keep it friendly, keep it on topic. By staying in this server you agree to these rules.',
    },
    {
      description: [
        '**1. Be respectful.** Treat everyone the way you want to be treated. Disagree without insults.',
        '**2. No harassment or hate.** No hate speech, slurs, threats or bullying, here or in members\' DMs.',
        '**3. No spam.** No flooding, repeated posts, walls of emoji or mass mentions.',
        '**4. No advertising.** No self-promotion, other scripts or services, server invites or links to them, in channels or DMs.',
        '**5. No NSFW.** Nothing sexual, gory or shocking, including names, avatars and links.',
        '**6. Stay on topic.** Use each channel for what it is for.',
        '**7. Don\'t share the script or codes.** No sharing, leaking, uploading or reselling T.C.P Premium, your downloads or your codes. Premium copies are fingerprinted.',
        '**8. No cracked or modified copies.** Don\'t post, ask for or offer cracked, unlocked or modified copies of T.C.P Premium, or ways around its lock.',
        `**9. Support in the right place.** Ask questions in ${at.help}; license, payment and bug problems go in a ticket. Please don't DM staff for support.`,
        '**10. No begging for free access.** Premium is a paid subscription and there is no free trial. Don\'t ask for free codes or copies.',
        '**11. Staff have the final say.** Follow staff instructions. If you disagree, open a ticket instead of arguing in public.',
        '**12. Follow Discord\'s rules.** Discord\'s Terms of Service and Community Guidelines apply here too.',
      ].join('\n'),
    },
    {
      title: '⚖️ Consequences',
      tone: 'danger',
      description: [
        '**Warning** ➜ **Mute** ➜ **Ban**',
        'Serious breaks (hate, threats, scams, leaking or reselling the script) can go straight to a ban, and sharing Premium can also cost you your access.',
      ].join('\n'),
    },
  ];
}

export const INFO_CONTENT: Record<InfoKey, (links: InfoLinks) => InfoSection[]> = { overview, faq, disclaimer, rules };
