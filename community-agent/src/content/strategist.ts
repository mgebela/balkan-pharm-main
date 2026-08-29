import type { ContentPillar } from '../load-config.ts';
import type { PublicConversation } from '../platforms/types.ts';
import type { MemorySnapshot } from '../agent/memory.ts';
import { unusedPillar } from '../agent/memory.ts';

export type InviteLevel = 'none' | 'soft' | 'fit';

export interface ContentStrategy {
  topic: string;
  audience: string;
  angle: string;
  pillar: ContentPillar;
  invite: InviteLevel;
  callToAction?: string;
  source: PublicConversation | null;
}

const INVITE_HINTS = [
  'journal',
  'log',
  'reminder',
  'coach',
  'ai',
  'track',
  'history',
  'proof',
  'on-chain',
  'solana',
];

function inviteFor(conversation: PublicConversation | null): InviteLevel {
  if (!conversation) return 'soft';
  const text = `${conversation.title} ${conversation.excerpt}`.toLowerCase();
  if (/\b(legal|lawyer|license|invest|apy|staking|redemption)\b/.test(text)) return 'none';
  if (INVITE_HINTS.some((hint) => text.includes(hint))) return 'soft';
  return 'none';
}

export function chooseStrategy(
  pillars: ContentPillar[],
  memory: MemorySnapshot,
  conversation: PublicConversation | null,
): ContentStrategy {
  const fromConversation = conversation
    ? pillars.find((pillar) =>
        `${conversation.title} ${conversation.excerpt}`.toLowerCase().includes(pillar.id),
      )
    : undefined;
  const pillar =
    fromConversation ??
    pillars.find((item) => item.id === unusedPillar(pillars.map((entry) => entry.id))) ??
    pillars[0];

  if (!pillar) {
    throw new Error('No content pillars configured');
  }

  const invite = inviteFor(conversation);
  const audience = conversation
    ? 'Growers already talking about this publicly'
    : 'Home growers who want a more reliable plant history';

  return {
    topic: pillar.id,
    audience,
    angle: conversation
      ? `Respond to a public thread about: ${conversation.title}`
      : pillar.summary,
    pillar,
    invite,
    callToAction:
      invite === 'none'
        ? undefined
        : 'If you want the log, reminders, and coach in one place, growtoo is free to try: https://growto.live/',
    source: conversation,
  };
}
