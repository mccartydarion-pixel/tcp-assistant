import type { TicketCategory, TicketStatus, TuningProfile } from '../knowledge/types.js';

export function classifyTicket(issue: string): TicketCategory {
  const text = issue.toLowerCase();

  if (/anti recoil|recoil|climb|pull.*down|drifts/i.test(text)) return 'RECOIL';
  if (/ads|precision|response|easing|sens/i.test(text)) return 'ADS_ACCURACY';
  if (/auto aim|r3|pulse/i.test(text)) return 'AUTO_AIM';
  if (/auto run|sprint/i.test(text)) return 'AUTO_RUN';
  if (/lean|follow lean/i.test(text)) return 'FOLLOW_LEAN';
  if (/menu|oled|page|save/i.test(text)) return 'MENU';
  if (/install|setup|connect|configure/i.test(text)) return 'INSTALLATION';
  if (/version|release/i.test(text)) return 'VERSION';
  if (/bug|error|crash|broken/i.test(text)) return 'BUG_REPORT';
  return 'GENERAL';
}

export function buildTicketSummary(params: {
  issue: string;
  version: string;
  settings: TuningProfile;
  observedBehavior: string;
  troubleshooting: string[];
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
}): string {
  const settings = [
    `V: ${params.settings.vertical ?? 'n/a'}`,
    `H: ${params.settings.horizontal ?? 'n/a'}`,
    `ADS Sens: ${params.settings.adsSens ?? 'n/a'}`,
    `Precision: ${params.settings.precision ?? 'n/a'}`,
    `Response: ${params.settings.response ?? 'n/a'}`,
    `Easing: ${params.settings.easing ?? 'n/a'}`,
  ].join('\n');

  return [
    'T.C.P. ASSISTANT — TICKET SUMMARY',
    '',
    `Issue: ${params.issue}`,
    '',
    `Version: ${params.version}`,
    '',
    'Settings:',
    settings,
    '',
    `Observed Behavior: ${params.observedBehavior}`,
    '',
    'Troubleshooting:',
    ...params.troubleshooting.map((step) => `• ${step}`),
    '',
    `Confidence: ${params.confidence}`,
  ].join('\n');
}

export function createInitialTicketState() {
  return {
    status: 'OPEN' as TicketStatus,
    category: 'GENERAL' as TicketCategory,
    summary: '',
    confidence: 'MEDIUM' as const,
  };
}
