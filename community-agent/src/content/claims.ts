import type { ApprovedFact, ContentDraft } from '../types.ts';

const UNAPPROVED_PATTERNS: Array<{ flag: string; re: RegExp }> = [
  { flag: 'unapproved-count', re: /\b\d{2,}[,.]?\d*\s*(growers|users|testers|signups|downloads)\b/i },
  { flag: 'unapproved-money', re: /\b\$\d|\braising\b|\bpre-seed\b|\bvaluation\b/i },
  { flag: 'unapproved-mainnet-date', re: /\bmainnet (in|on|by|q[1-4])\b/i },
  { flag: 'token-value', re: /\b(\$growtoo (has|holds|is worth)|real value|monetary value(?!.*no))\b/i },
];

function normalize(text: string): string {
  return text.toLowerCase().replace(/[“”"']/g, '').replace(/\s+/g, ' ').trim();
}

export function claimAllowed(sentence: string, facts: ApprovedFact[], phrases: string[]): boolean {
  const needle = normalize(sentence);
  if (needle.length < 12) return true;
  return [...facts.map((fact) => fact.text), ...phrases].some((allowed) => {
    const hay = normalize(allowed);
    return hay.includes(needle) || needle.includes(hay) || overlap(needle, hay) >= 0.72;
  });
}

function overlap(a: string, b: string): number {
  const aWords = new Set(a.split(' ').filter((word) => word.length > 3));
  const bWords = new Set(b.split(' ').filter((word) => word.length > 3));
  if (aWords.size === 0 || bWords.size === 0) return 0;
  let hit = 0;
  for (const word of aWords) if (bWords.has(word)) hit += 1;
  return hit / Math.max(aWords.size, bWords.size);
}

export function extractSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 20);
}

export function checkClaims(
  draft: Pick<ContentDraft, 'masterIdea' | 'xVersion' | 'instagramVersion' | 'facebookVersion' | 'factualClaims'>,
  facts: ApprovedFact[],
  phrases: string[],
): string[] {
  const flags: string[] = [];
  const body = [draft.masterIdea, draft.xVersion, draft.instagramVersion, draft.facebookVersion]
    .filter(Boolean)
    .join('\n');

  for (const { flag, re } of UNAPPROVED_PATTERNS) {
    if (!re.test(body)) continue;
    if (flag === 'token-value' && /no monetary value/.test(body.toLowerCase())) continue;
    flags.push(flag);
  }

  if (/mainnet is live|live on mainnet/i.test(body)) flags.push('status-mismatch-mainnet');
  if (/\bredemption is live\b/i.test(body)) flags.push('status-mismatch-redemption');

  for (const claim of draft.factualClaims) {
    if (!claimAllowed(claim, facts, phrases)) flags.push(`unapproved-claim:${claim.slice(0, 80)}`);
  }

  return [...new Set(flags)];
}

export function factsForTopic(facts: ApprovedFact[], topic: string): string[] {
  const topicWords = topic.toLowerCase().split(/\W+/).filter((word) => word.length > 3);
  const matched = facts.filter((fact) => topicWords.some((word) => fact.text.toLowerCase().includes(word)));
  const fallback = facts.filter((fact) => fact.status === 'live' || fact.status === 'early').slice(0, 3);
  return (matched.length ? matched : fallback).slice(0, 4).map((fact) => fact.text);
}
