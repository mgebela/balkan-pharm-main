import type { ContentDraft } from '../types.ts';

export interface SafetyFinding {
  flag: string;
  severity: 'block' | 'review';
  excerpt: string;
}

const BLOCK_PATTERNS: Array<{ flag: string; re: RegExp }> = [
  { flag: 'medical', re: /\b(diagnos|prescrib|cur(es|ed|ing)\b|treat(s|ed|ing)? cancer|dosage|mg\/|edible for (pain|anxiety|sleep))\b/i },
  { flag: 'legal-evasion', re: /\b(hide (the )?grow|avoid (the )?cops|how to hide|illegal grow|break the law|get around (the )?law)\b/i },
  { flag: 'legal-everywhere', re: /\b(cannabis is legal( everywhere)?|legal in all|legal worldwide)\b/i },
  { flag: 'financial', re: /\b(apy|yield|roi|guaranteed return|moon|number go up|invest now|staking rewards|harvest redemption (is|now) live)\b/i },
  { flag: 'token-lead', re: /\b(\$growtoo is (worth|valuable)|buy \$growtoo|token utility)\b/i },
  { flag: 'personal-grow', re: /\b(my (tent|girls|plants|last grow)|i just (checked|fed|watered) my)\b/i },
  { flag: 'traction', re: /\b(\d{3,} (growers|users|signups)|retention is|everyone (uses|loves) growtoo)\b/i },
  { flag: 'mainnet-live', re: /\b(mainnet is live|live on mainnet|mainnet launch(ed)? (today|now))\b/i },
  { flag: 'private-data', re: /\b([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}|(?:0x)?[1-9A-HJ-NP-Za-km-z]{32,44})\b/ },
];

const REVIEW_PATTERNS: Array<{ flag: string; re: RegExp }> = [
  { flag: 'legal', re: /\b(legal(ity)?|jurisdiction|license[d]?|regulated)\b/i },
  { flag: 'financial-mention', re: /\b(\$growtoo|staking|redemption|rwa|token)\b/i },
  { flag: 'person-named', re: /\b(partnership with|we partnered|investor[s]?|raising \$)\b/i },
  { flag: 'cultivation-recipe', re: /\b(ppm|ec of|feed (schedule|chart)|ml per|how much (nute|nutrient))\b/i },
];

function scan(text: string): SafetyFinding[] {
  const findings: SafetyFinding[] = [];
  for (const { flag, re } of BLOCK_PATTERNS) {
    const match = text.match(re);
    if (match) findings.push({ flag, severity: 'block', excerpt: match[0] });
  }
  for (const { flag, re } of REVIEW_PATTERNS) {
    const match = text.match(re);
    if (match) findings.push({ flag, severity: 'review', excerpt: match[0] });
  }
  return findings;
}

export function checkSafety(draft: Pick<ContentDraft, 'masterIdea' | 'xVersion' | 'instagramVersion' | 'facebookVersion' | 'callToAction'>): SafetyFinding[] {
  const text = [draft.masterIdea, draft.xVersion, draft.instagramVersion, draft.facebookVersion, draft.callToAction]
    .filter(Boolean)
    .join('\n');
  const seen = new Set<string>();
  return scan(text).filter((finding) => {
    const key = `${finding.flag}:${finding.excerpt}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function safetyFlags(draft: Parameters<typeof checkSafety>[0]): string[] {
  return [...new Set(checkSafety(draft).map((finding) => finding.flag))];
}

export function hasBlockingSafetyIssue(draft: Parameters<typeof checkSafety>[0]): boolean {
  return checkSafety(draft).some((finding) => finding.severity === 'block');
}
