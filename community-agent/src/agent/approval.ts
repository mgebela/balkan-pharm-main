import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import type { DraftRecord } from '../db/schema.ts';
import { todayStamp } from '../db/client.ts';
import { logPath, queueDir } from '../paths.ts';
import type { ReviewCard } from '../types.ts';
import { getDraft, listPendingDrafts, rememberDraft } from './memory.ts';

export function toReviewCard(draft: DraftRecord): ReviewCard {
  return {
    draftId: draft.id,
    source: draft.sourceUrls[0] ?? 'content pillar (no public thread selected)',
    draft,
    reasoning: draft.reasoning,
    riskFlags: draft.riskFlags,
    pillar: draft.pillar,
    conversationTitle: draft.topic,
  };
}

export function renderReviewCard(card: ReviewCard): string {
  const draft = card.draft;
  return [
    `## Review card · ${card.draftId}`,
    '',
    `- Status: ${draft.approvalStatus}`,
    `- Topic: ${draft.topic}`,
    `- Audience: ${draft.audience}`,
    `- Source: ${card.source}`,
    `- Reasoning: ${card.reasoning}`,
    `- Risk flags: ${card.riskFlags.length ? card.riskFlags.join(', ') : 'none'}`,
    `- Claims: ${draft.factualClaims.join(' | ') || 'none'}`,
    `- CTA: ${draft.callToAction ?? 'none'}`,
    '',
    '### Master idea',
    '',
    draft.masterIdea,
    '',
    '### X',
    '',
    draft.xVersion ?? '',
    '',
    '### Instagram',
    '',
    draft.instagramVersion ?? '',
    '',
    '### Facebook',
    '',
    draft.facebookVersion ?? '',
    '',
  ].join('\n');
}

export function queueForReview(draft: DraftRecord): ReviewCard {
  const card = toReviewCard(draft);
  mkdirSync(queueDir(), { recursive: true });
  const queueFile = path.join(queueDir(), `${todayStamp()}.md`);
  const header = existsSync(queueFile)
    ? readFileSync(queueFile, 'utf8')
    : `# Queue ${todayStamp()}\n\nStatus: waiting for approval\n\n`;
  writeFileSync(queueFile, `${header}${renderReviewCard(card)}\n`, 'utf8');
  return card;
}

export function approveDraft(id: string): DraftRecord {
  return setStatus(id, 'approved');
}

export function rejectDraft(id: string): DraftRecord {
  return setStatus(id, 'rejected');
}

function setStatus(id: string, approvalStatus: 'approved' | 'rejected'): DraftRecord {
  const draft = getDraft(id);
  if (!draft) throw new Error(`Unknown draft ${id}`);
  if (approvalStatus === 'approved' && draft.riskFlags.some(isBlockingFlag)) {
    throw new Error(`Cannot approve ${id} while blocking flags remain: ${draft.riskFlags.join(', ')}`);
  }
  const next = { ...draft, approvalStatus };
  rememberDraft(next);
  return next;
}

const BLOCKING = new Set([
  'medical',
  'legal-evasion',
  'legal-everywhere',
  'financial',
  'token-lead',
  'personal-grow',
  'traction',
  'mainnet-live',
  'private-data',
  'unapproved-count',
  'unapproved-money',
  'token-value',
  'status-mismatch-mainnet',
  'status-mismatch-redemption',
]);

function isBlockingFlag(flag: string): boolean {
  return BLOCKING.has(flag) || flag.startsWith('unapproved-claim:');
}

export function publishApproved(id: string): DraftRecord {
  const draft = getDraft(id);
  if (!draft) throw new Error(`Unknown draft ${id}`);
  if (draft.approvalStatus !== 'approved') {
    throw new Error('Publish only after approval');
  }
  mkdirSync(queueDir(), { recursive: true });
  const ready = path.join(queueDir(), `${todayStamp()}-approved-${id}.md`);
  writeFileSync(ready, `${renderReviewCard(toReviewCard(draft))}\nReady to copy by hand. No platform API was called.\n`, 'utf8');
  appendLog(`Published locally (copy-paste only): ${id} · ${draft.topic}`);
  return draft;
}

export function logPublish(line: string): void {
  appendLog(line);
}

export function pendingCards(): ReviewCard[] {
  return listPendingDrafts().map(toReviewCard);
}

function appendLog(line: string): void {
  mkdirSync(path.dirname(logPath()), { recursive: true });
  const prev = existsSync(logPath()) ? readFileSync(logPath(), 'utf8') : '# Community log\n';
  writeFileSync(logPath(), `${prev.trimEnd()}\n\n### ${todayStamp()}\n\n- ${line}\n`, 'utf8');
}
