import type { ContentPillar } from '../load-config.ts';
import type { PublicConversation } from '../platforms/types.ts';
import type { RelevanceScore } from '../types.ts';

const USEFUL_HINTS = [
  'how do',
  'how to',
  'anyone else',
  'looking for',
  'recommend',
  'journal',
  'log',
  'reminder',
  'forgot',
  'consistency',
  'coach',
  'ai',
  'notes',
  'tracking',
  'weather',
];

const SKIP_HINTS = [
  'hide my grow',
  'illegal',
  'cops',
  'what strain gets you',
  'best high',
  'buy seeds cheap',
  'guaranteed profit',
  'moon',
  'airdrop',
];

const RISK_HINTS = [
  'legal',
  'lawyer',
  'license',
  'medical',
  'anxiety',
  'insomnia',
  'invest',
  'apy',
  'staking',
  'redemption',
];

function haystack(conversation: PublicConversation): string {
  return `${conversation.title} ${conversation.excerpt}`.toLowerCase();
}

function hits(text: string, needles: string[]): string[] {
  return needles.filter((needle) => text.includes(needle));
}

export function scoreConversation(conversation: PublicConversation, pillars: ContentPillar[]): RelevanceScore {
  const text = haystack(conversation);
  const reasons: string[] = [];

  const pillarHits = pillars.filter((pillar) => {
    const words = `${pillar.id} ${pillar.summary} ${pillar.searchQueries.join(' ')}`
      .toLowerCase()
      .split(/\W+/)
      .filter((word) => word.length > 4);
    return words.some((word) => text.includes(word));
  });
  const usefulHits = hits(text, USEFUL_HINTS);
  const skipHits = hits(text, SKIP_HINTS);
  const riskHits = hits(text, RISK_HINTS);

  const relevance = Math.min(1, pillarHits.length * 0.28 + usefulHits.length * 0.08);
  const usefulness = Math.min(1, usefulHits.length * 0.18 + (/\?/.test(text) ? 0.25 : 0));
  const risk = Math.min(1, skipHits.length * 0.5 + riskHits.length * 0.25);

  if (pillarHits.length) reasons.push(`pillar:${pillarHits.map((pillar) => pillar.id).join(',')}`);
  if (usefulHits.length) reasons.push(`useful:${usefulHits.slice(0, 3).join(',')}`);
  if (skipHits.length) reasons.push(`skip:${skipHits.join(',')}`);
  if (riskHits.length) reasons.push(`risk:${riskHits.join(',')}`);

  const shouldReply =
    relevance >= 0.35 &&
    usefulness >= 0.18 &&
    risk < 0.4 &&
    skipHits.length === 0 &&
    conversation.excerpt.length + conversation.title.length > 40;

  if (!shouldReply && !reasons.length) reasons.push('thin-or-off-topic');

  return {
    relevance: Number(relevance.toFixed(2)),
    usefulness: Number(usefulness.toFixed(2)),
    risk: Number(risk.toFixed(2)),
    shouldReply,
    reasons,
  };
}

export function pickEngageable(
  scored: Array<{ conversation: PublicConversation; scores: RelevanceScore }>,
): { conversation: PublicConversation; scores: RelevanceScore } | undefined {
  return scored
    .filter((item) => item.scores.shouldReply)
    .sort((a, b) => b.scores.relevance + b.scores.usefulness - a.scores.relevance - a.scores.usefulness)[0];
}
